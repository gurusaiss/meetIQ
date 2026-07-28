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
import type { CaptureSource } from "../integrations/capture.ts";
import type { LmsConnector, LmsItem } from "../integrations/lms.ts";
import {
  notesToMarkdown,
  flashcardsToAnkiCsv,
  quizToMarkdown,
} from "../export/exporters.ts";
import type { RevisionNotes, Quiz, Flashcard } from "../types.ts";

export type Role = "student" | "faculty" | "ta" | "admin";
export interface Actor {
  id: string;
  role: Role;
}

export class ComplianceError extends Error {}
export class AuthorizationError extends Error {}
export class ConflictError extends Error {}

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

  async seedInstitution(i: Institution, course: Course): Promise<void> {
    await this.repo.upsertInstitution(i);
    await this.repo.upsertCourse(course);
  }

  async createLecture(input: CreateLectureInput): Promise<Lecture> {
    const inst = await this.repo.getInstitution(input.institutionId);
    if (!inst) throw new ComplianceError(`Unknown institution ${input.institutionId}`);

    // Checked explicitly (rather than letting the insert's primary-key
    // violation bubble up) so a double form-submission or a resubmitted
    // browser-back request surfaces a clear, catchable error instead of an
    // adapter-specific SQL error string leaking into a generic 500.
    if (await this.repo.getLecture(input.institutionId, input.lectureId)) {
      throw new ConflictError(`Lecture ${input.lectureId} already exists.`);
    }

    const lecture: Lecture = {
      id: input.lectureId,
      institutionId: input.institutionId,
      courseId: input.courseId,
      mediaRef: input.mediaRef,
      status: "created",
      captureSource: input.captureSource,
      createdAt: new Date().toISOString(),
    };
    await this.repo.createLecture(lecture);

    const consent: ConsentRecord = {
      lectureId: input.lectureId,
      institutionId: input.institutionId,
      policy: inst.consentPolicy,
      noticeShown: input.consent.noticeShown,
      optOuts: input.consent.optOuts ?? [],
    };
    await this.repo.saveConsent(consent);
    await this.audit(input.institutionId, "system", "lecture.created", input.lectureId);
    return lecture;
  }

  /** Runs the pipeline and persists all outputs. Gated by consent. */
  async processLecture(
    institutionId: string,
    lectureId: string,
    opts: { diarize?: boolean; speakerHints?: Record<string, string> } = {},
  ): Promise<StoredAsset[]> {
    const lecture = await this.repo.getLecture(institutionId, lectureId);
    if (!lecture) throw new Error(`Lecture ${lectureId} not found`);

    await this.assertConsent(institutionId, lectureId);

    await this.repo.setLectureStatus(institutionId, lectureId, "processing");
    try {
      const result = await runPipeline({
        lectureId,
        mediaRef: lecture.mediaRef,
        ...(opts.diarize !== undefined ? { diarize: opts.diarize } : {}),
        ...(opts.speakerHints ? { speakerHints: opts.speakerHints } : {}),
      });

      await this.repo.saveTranscript(institutionId, result.transcript);
      const stored = await this.repo.saveAssets(institutionId, lectureId, result.assets);
      await this.repo.saveChunks(institutionId, lecture.courseId, result.chunks);
      await this.repo.setLectureStatus(institutionId, lectureId, "processed");
      await this.audit(institutionId, "system", "lecture.processed", lectureId);
      return stored;
    } catch (err) {
      await this.repo.setLectureStatus(institutionId, lectureId, "failed");
      throw err;
    }
  }

  /** Compliance gate (moat #2). */
  private async assertConsent(institutionId: string, lectureId: string): Promise<void> {
    const consent = await this.repo.getConsent(institutionId, lectureId);
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
  async approveAsset(institutionId: string, assetId: string, actor: Actor): Promise<StoredAsset> {
    if (actor.role !== "faculty" && actor.role !== "ta") {
      throw new AuthorizationError(
        `Role ${actor.role} cannot approve assets; only faculty/TA can.`,
      );
    }
    const asset = await this.repo.getAsset(institutionId, assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);
    await this.repo.setAssetStatus(institutionId, assetId, "approved");
    await this.audit(institutionId, actor.id, "asset.approved", assetId);
    return { ...asset, status: "approved" };
  }

  /** What a student is allowed to see: approved assets only. */
  async studentAssets(institutionId: string, lectureId: string): Promise<StoredAsset[]> {
    const assets = await this.repo.listAssets(institutionId, lectureId);
    return assets.filter((a) => a.status === "approved");
  }

  /** What faculty sees in the review queue: everything, drafts first. */
  async reviewQueue(institutionId: string, lectureId: string): Promise<StoredAsset[]> {
    const order = { auto_held: 0, draft: 1, approved: 2 } as const;
    const assets = await this.repo.listAssets(institutionId, lectureId);
    return assets.sort((a, b) => order[a.status] - order[b.status]);
  }

  /** Course-wide semantic search ("chat with the course"), with citations. */
  async searchCourse(
    institutionId: string,
    courseId: string,
    query: string,
    topK = 3,
  ): Promise<SearchHit[]> {
    const chunks = await this.repo.listCourseChunks(institutionId, courseId);
    const embeddings = getEmbeddingsProvider();
    await this.audit(institutionId, "student", "course.search", courseId);
    return search(embeddings, chunks, query, topK);
  }

  /** Right-to-erasure. Faculty/TA/admin only. Removes all derived data. */
  async deleteLecture(institutionId: string, lectureId: string, actor: Actor): Promise<void> {
    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      throw new AuthorizationError(`Role ${actor.role} cannot delete lectures.`);
    }
    if (!(await this.repo.getLecture(institutionId, lectureId))) {
      throw new Error(`Lecture ${lectureId} not found`);
    }
    await this.repo.deleteLecture(institutionId, lectureId);
    await this.audit(institutionId, actor.id, "lecture.deleted", lectureId);
  }

  /**
   * Retention enforcement (moat #2). Deletes lectures older than the tenant's
   * retentionDays. Admin only. `now` is injected for testability.
   */
  async runRetention(institutionId: string, actor: Actor, now: Date = new Date()): Promise<number> {
    if (actor.role !== "admin") {
      throw new AuthorizationError(`Role ${actor.role} cannot run retention.`);
    }
    const inst = await this.repo.getInstitution(institutionId);
    if (!inst) throw new Error(`Unknown institution ${institutionId}`);
    const cutoff = new Date(now.getTime() - inst.retentionDays * 86_400_000).toISOString();
    let purged = 0;
    for (const l of await this.repo.listLectures(institutionId)) {
      if (l.createdAt < cutoff) {
        await this.repo.deleteLecture(institutionId, l.id);
        await this.audit(institutionId, actor.id, "lecture.purged", l.id);
        purged++;
      }
    }
    return purged;
  }

  /**
   * Import recordings from a capture source (Echo360/Panopto/…) as lectures
   * (moat #4). Consent is seeded from the source's captured-consent flag, so
   * the downstream compliance gate stays honest. Skips already-imported ids.
   */
  async importFromCapture(
    institutionId: string,
    courseId: string,
    source: CaptureSource,
    externalCourseId: string,
    actor: Actor,
  ): Promise<string[]> {
    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      throw new AuthorizationError(`Role ${actor.role} cannot import recordings.`);
    }
    const recordings = await source.listRecordings(externalCourseId);
    const imported: string[] = [];
    for (const rec of recordings) {
      const lectureId = rec.externalId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (await this.repo.getLecture(institutionId, lectureId)) continue; // idempotent
      await this.createLecture({
        institutionId,
        courseId,
        lectureId,
        mediaRef: rec.mediaRef,
        captureSource: source.name,
        consent: { noticeShown: rec.consentCaptured },
      });
      await this.audit(institutionId, actor.id, "lecture.imported", lectureId);
      imported.push(lectureId);
    }
    return imported;
  }

  /**
   * Push approved assets to the LMS (moat #4). Only approved assets are sent —
   * the faculty gate extends to LMS delivery. Returns the number pushed.
   */
  async publishToLms(
    institutionId: string,
    lectureId: string,
    connector: LmsConnector,
    externalCourseId: string,
    actor: Actor,
  ): Promise<number> {
    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      throw new AuthorizationError(`Role ${actor.role} cannot publish to the LMS.`);
    }
    const allAssets = await this.repo.listAssets(institutionId, lectureId);
    const approved = allAssets.filter((a) => a.status === "approved");

    const items: LmsItem[] = approved.map((a) => {
      if (a.type === "notes") {
        return {
          lectureId,
          type: "notes",
          title: `${lectureId} — Revision Notes`,
          body: notesToMarkdown(lectureId, a.content as RevisionNotes),
          contentType: "text/markdown",
        };
      }
      if (a.type === "flashcards") {
        return {
          lectureId,
          type: "flashcards",
          title: `${lectureId} — Flashcards`,
          body: flashcardsToAnkiCsv((a.content as { cards: Flashcard[] }).cards),
          contentType: "text/csv",
        };
      }
      return {
        lectureId,
        type: "quiz",
        title: `${lectureId} — Quiz`,
        body: quizToMarkdown(lectureId, a.content as Quiz),
        contentType: "text/markdown",
      };
    });

    if (items.length === 0) return 0;
    const count = await connector.publish(externalCourseId, items);
    await this.audit(institutionId, actor.id, "lms.published", `${lectureId} (${count} items)`);
    return count;
  }

  private async audit(institutionId: string, actor: string, action: string, target: string): Promise<void> {
    await this.repo.audit({
      institutionId,
      actor,
      action,
      target,
      ts: new Date().toISOString(),
    });
  }
}
