/**
 * Application service: orchestrates pipeline + persistence + compliance.
 *
 * This is where two moats stop being data and become enforced rules:
 *  - Compliance gate (moat #2): a lecture in an all-party-consent tenant
 *    cannot be processed until a consent notice is recorded. Processing
 *    throws otherwise — the UMass-style ban risk is designed out.
 *  - Faculty approval gate (FR-14): only a faculty/TA actor can move an
 *    asset to `approved`; students only ever see approved assets.
 * Every state change writes an audit event (compliance evidence for "Ted").
 */
import type { SearchHit } from "../types.ts";
import type {
  Repository,
  Institution,
  Course,
  ConsentRecord,
  Lecture,
  StoredAsset,
} from "../persistence/repository.ts";
import { processLecture as runPipeline } from "../pipeline/pipeline.ts";
import { search } from "../pipeline/rag.ts";
import { getEmbeddingsProvider } from "../providers/embeddings/index.ts";

export type Role = "student" | "faculty" | "ta" | "admin";
export interface Actor {
  id: string;
  role: Role;
}

export class ComplianceError extends Error {}
export class AuthorizationError extends Error {}

export interface CreateLectureInput {
  institutionId: string;
  courseId: string;
  lectureId: string;
  mediaRef: string;
  captureSource: string;
  consent: { noticeShown: boolean; optOuts?: string[] };
}

export class LectureService {
  private readonly repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  seedInstitution(i: Institution, course: Course): void {
    this.repo.upsertInstitution(i);
    this.repo.upsertCourse(course);
  }

  createLecture(input: CreateLectureInput): Lecture {
    const inst = this.repo.getInstitution(input.institutionId);
    if (!inst) throw new ComplianceError(`Unknown institution ${input.institutionId}`);

    const lecture: Lecture = {
      id: input.lectureId,
      institutionId: input.institutionId,
      courseId: input.courseId,
      mediaRef: input.mediaRef,
      status: "created",
      captureSource: input.captureSource,
      createdAt: new Date().toISOString(),
    };
    this.repo.createLecture(lecture);

    const consent: ConsentRecord = {
      lectureId: input.lectureId,
      institutionId: input.institutionId,
      policy: inst.consentPolicy,
      noticeShown: input.consent.noticeShown,
      optOuts: input.consent.optOuts ?? [],
    };
    this.repo.saveConsent(consent);
    this.audit(input.institutionId, "system", "lecture.created", input.lectureId);
    return lecture;
  }

  /** Runs the pipeline and persists all outputs. Gated by consent. */
  async processLecture(
    institutionId: string,
    lectureId: string,
    opts: { diarize?: boolean; speakerHints?: Record<string, string> } = {},
  ): Promise<StoredAsset[]> {
    const lecture = this.repo.getLecture(institutionId, lectureId);
    if (!lecture) throw new Error(`Lecture ${lectureId} not found`);

    this.assertConsent(institutionId, lectureId);

    this.repo.setLectureStatus(institutionId, lectureId, "processing");
    try {
      const result = await runPipeline({
        lectureId,
        mediaRef: lecture.mediaRef,
        ...(opts.diarize !== undefined ? { diarize: opts.diarize } : {}),
        ...(opts.speakerHints ? { speakerHints: opts.speakerHints } : {}),
      });

      this.repo.saveTranscript(institutionId, result.transcript);
      const stored = this.repo.saveAssets(institutionId, lectureId, result.assets);
      this.repo.saveChunks(institutionId, lecture.courseId, result.chunks);
      this.repo.setLectureStatus(institutionId, lectureId, "processed");
      this.audit(institutionId, "system", "lecture.processed", lectureId);
      return stored;
    } catch (err) {
      this.repo.setLectureStatus(institutionId, lectureId, "failed");
      throw err;
    }
  }

  /** Compliance gate (moat #2). */
  private assertConsent(institutionId: string, lectureId: string): void {
    const consent = this.repo.getConsent(institutionId, lectureId);
    if (!consent) {
      throw new ComplianceError(`No consent record for lecture ${lectureId}`);
    }
    if (consent.policy === "all_party" && !consent.noticeShown) {
      throw new ComplianceError(
        `All-party-consent tenant: recording notice was not shown for ${lectureId}. Refusing to process.`,
      );
    }
  }

  /** Faculty approval gate (FR-14). Students never bypass this. */
  approveAsset(institutionId: string, assetId: string, actor: Actor): StoredAsset {
    if (actor.role !== "faculty" && actor.role !== "ta") {
      throw new AuthorizationError(
        `Role ${actor.role} cannot approve assets; only faculty/TA can.`,
      );
    }
    const asset = this.repo.getAsset(institutionId, assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);
    this.repo.setAssetStatus(institutionId, assetId, "approved");
    this.audit(institutionId, actor.id, "asset.approved", assetId);
    return { ...asset, status: "approved" };
  }

  /** What a student is allowed to see: approved assets only. */
  studentAssets(institutionId: string, lectureId: string): StoredAsset[] {
    return this.repo
      .listAssets(institutionId, lectureId)
      .filter((a) => a.status === "approved");
  }

  /** What faculty sees in the review queue: everything, drafts first. */
  reviewQueue(institutionId: string, lectureId: string): StoredAsset[] {
    const order = { auto_held: 0, draft: 1, approved: 2 } as const;
    return this.repo
      .listAssets(institutionId, lectureId)
      .sort((a, b) => order[a.status] - order[b.status]);
  }

  /** Course-wide semantic search ("chat with the course"), with citations. */
  async searchCourse(
    institutionId: string,
    courseId: string,
    query: string,
    topK = 3,
  ): Promise<SearchHit[]> {
    const chunks = this.repo.listCourseChunks(institutionId, courseId);
    const embeddings = getEmbeddingsProvider();
    this.audit(institutionId, "student", "course.search", courseId);
    return search(embeddings, chunks, query, topK);
  }

  /** Right-to-erasure. Faculty/TA/admin only. Removes all derived data. */
  deleteLecture(institutionId: string, lectureId: string, actor: Actor): void {
    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      throw new AuthorizationError(`Role ${actor.role} cannot delete lectures.`);
    }
    if (!this.repo.getLecture(institutionId, lectureId)) {
      throw new Error(`Lecture ${lectureId} not found`);
    }
    this.repo.deleteLecture(institutionId, lectureId);
    this.audit(institutionId, actor.id, "lecture.deleted", lectureId);
  }

  /**
   * Retention enforcement (moat #2). Deletes lectures older than the tenant's
   * retentionDays. Admin only. `now` is injected for testability.
   */
  runRetention(institutionId: string, actor: Actor, now: Date = new Date()): number {
    if (actor.role !== "admin") {
      throw new AuthorizationError(`Role ${actor.role} cannot run retention.`);
    }
    const inst = this.repo.getInstitution(institutionId);
    if (!inst) throw new Error(`Unknown institution ${institutionId}`);
    const cutoff = new Date(now.getTime() - inst.retentionDays * 86_400_000).toISOString();
    let purged = 0;
    for (const l of this.repo.listLectures(institutionId)) {
      if (l.createdAt < cutoff) {
        this.repo.deleteLecture(institutionId, l.id);
        this.audit(institutionId, actor.id, "lecture.purged", l.id);
        purged++;
      }
    }
    return purged;
  }

  private audit(institutionId: string, actor: string, action: string, target: string): void {
    this.repo.audit({
      institutionId,
      actor,
      action,
      target,
      ts: new Date().toISOString(),
    });
  }
}
