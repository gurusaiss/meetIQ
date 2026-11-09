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
import { randomBytes } from "node:crypto";
import type { SearchHit, Transcript } from "../types.ts";
import type {
  Repository,
  Institution,
  Course,
  ConsentRecord,
  Lecture,
  StoredAsset,
  AuditEvent,
  ActionStatus,
  CoursePatch,
} from "../persistence/repository.ts";
import { processLecture as runPipeline } from "../pipeline/pipeline.ts";
import { search } from "../pipeline/rag.ts";
import { getEmbeddingsProvider } from "../providers/embeddings/index.ts";
import type { CaptureSource } from "../integrations/capture.ts";
import type { LmsConnector, LmsItem } from "../integrations/lms.ts";
import type { JobQueue } from "../queue/job-queue.ts";
import { InMemoryJobQueue } from "../queue/job-queue.ts";
import { config } from "../config.ts";
import { logger } from "../observability/logger.ts";
import { verifyChain, transcriptDigest, type ChainVerification } from "../audit/chain.ts";
import {
  notesToMarkdown,
  flashcardsToAnkiCsv,
  quizToMarkdown,
  actionsToMarkdown,
} from "../export/exporters.ts";
import type { RevisionNotes, Quiz, Flashcard, ActionsAndDecisions } from "../types.ts";

export type Role = "student" | "faculty" | "ta" | "admin" | "auditor";
export interface Actor {
  id: string;
  role: Role;
}

const STAFF: Role[] = ["faculty", "ta", "admin"];
const isStaff = (r: Role) => STAFF.includes(r);
/** Who can create and edit courses and manage who is enrolled. TAs can read rosters but not change them. */
const COURSE_MANAGERS: Role[] = ["faculty", "admin"];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCourseCode(): string {
  let out = "";
  for (const b of randomBytes(8)) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export class ComplianceError extends Error {
  override name = "ComplianceError";
}
export class AuthorizationError extends Error {
  override name = "AuthorizationError";
}
export class ConflictError extends Error {
  override name = "ConflictError";
}
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
export class ValidationError extends Error {
  override name = "ValidationError";
}

/** One action item from an approved meeting, joined with what people have done about it. */
export interface TrackedAction {
  lectureId: string;
  /** Position within that meeting's action items (the update key). */
  index: number;
  text: string;
  /** The speaker label the transcript attached; a hint, not a person. */
  speaker: string | null;
  /** Who staff assigned it to, if anyone. */
  assignee: string | null;
  done: boolean;
  confidence: number;
  flagged: boolean;
  sourceRefs: string[];
  /** When the meeting was recorded; items are ordered newest meeting first. */
  lectureCreatedAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

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
  private readonly jobs: JobQueue;

  constructor(repo: Repository, jobs: JobQueue = new InMemoryJobQueue({ concurrency: config.queue.concurrency })) {
    this.repo = repo;
    this.jobs = jobs;
  }

  /** Exposed for graceful shutdown (drain before exit) and tests (await background work). */
  get queue(): JobQueue {
    return this.jobs;
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
    try {
      await this.repo.createLecture(lecture);
    } catch (e) {
      // Lecture ids are unique across the whole database, so another organisation may already hold this one.
      // Say nothing about who has it.
      const msg = e instanceof Error ? e.message : "";
      if (/unique|duplicate key|23505/i.test(msg)) {
        throw new ConflictError(`Lecture id ${input.lectureId} is already in use. Choose a different id.`);
      }
      throw e;
    }

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
    if (!lecture) throw new NotFoundError(`Lecture ${lectureId} not found`);

    // Asset/chunk ids are deterministic per lecture (`${lectureId}:${type}:${i}`,
    // `${lectureId}:chunk:${topicId}`) and the underlying inserts are plain
    // INSERTs, not upserts — re-running the pipeline against a lecture that
    // already has rows (processing/processed/failed-with-partial-writes)
    // would hit a primary-key violation and flip a previously "processed"
    // lecture to "failed", discarding nothing but *reporting* data loss.
    // Reprocessing is a real recovery path a failed run needs, but silently
    // upserting over faculty-approved content would be worse (an approve
    // decision quietly reverting). So it's blocked outright here; the
    // supported recovery for a failed lecture is delete (removes all derived
    // data, already tested) + recreate, not an in-place retry.
    if (lecture.status !== "created") {
      throw new ConflictError(
        `Lecture ${lectureId} is already ${lecture.status === "failed" ? "in a failed state" : lecture.status} — ` +
          `delete it and create it again to retry processing.`,
      );
    }

    await this.assertConsent(institutionId, lectureId);

    await this.repo.setLectureStatus(institutionId, lectureId, "processing");
    return this.runPipelineAndPersist(institutionId, lectureId, lecture.courseId, lecture.mediaRef, opts);
  }

  /**
   * Same validation and compliance gate as `processLecture`, but returns as
   * soon as the lecture is marked `processing` — the actual pipeline run
   * (transcription + several LLM calls) happens on the background job queue
   * instead of holding the caller's request open. This is the entry point
   * the HTTP layer uses; `processLecture` stays available as the direct,
   * synchronous call (useful for the CLI demo, and for tests that want a
   * deterministic result without reaching into the queue).
   *
   * Errors from validation/consent (bad state, missing consent) still throw
   * synchronously — those are the caller's mistake and deserve an immediate
   * response, not a silently-failed background job. Errors from the pipeline
   * itself (bad audio, provider failure) happen after this resolves; they
   * flip the lecture to `failed`, same as the synchronous path, visible on
   * the dashboard — there is no HTTP response left to carry them.
   */
  async enqueueProcessLecture(
    institutionId: string,
    lectureId: string,
    opts: { diarize?: boolean; speakerHints?: Record<string, string> } = {},
  ): Promise<void> {
    const lecture = await this.repo.getLecture(institutionId, lectureId);
    if (!lecture) throw new NotFoundError(`Lecture ${lectureId} not found`);
    if (lecture.status !== "created") {
      throw new ConflictError(
        `Lecture ${lectureId} is already ${lecture.status === "failed" ? "in a failed state" : lecture.status} — ` +
          `delete it and create it again to retry processing.`,
      );
    }
    await this.assertConsent(institutionId, lectureId);

    await this.repo.setLectureStatus(institutionId, lectureId, "processing");
    this.jobs.enqueue(async () => {
      try {
        await this.runPipelineAndPersist(institutionId, lectureId, lecture.courseId, lecture.mediaRef, opts);
      } catch (err) {
        // runPipelineAndPersist already recorded "failed" status; this only
        // stops the error from being an unhandled rejection inside the queue.
        logger.error("lecture.process.job_failed", {
          institutionId,
          lectureId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  /** Runs the pipeline and persists its outputs. Shared by the synchronous
   *  and queued processing paths — the lecture is already `processing` by
   *  the time this is called. */
  private async runPipelineAndPersist(
    institutionId: string,
    lectureId: string,
    courseId: string,
    mediaRef: string,
    opts: { diarize?: boolean; speakerHints?: Record<string, string> },
  ): Promise<StoredAsset[]> {
    try {
      const result = await runPipeline({
        lectureId,
        mediaRef,
        ...(opts.diarize !== undefined ? { diarize: opts.diarize } : {}),
        ...(opts.speakerHints ? { speakerHints: opts.speakerHints } : {}),
      });

      await this.repo.saveTranscript(institutionId, result.transcript);
      // Chain-of-custody: record a fingerprint of the transcript as produced, inside the
      // tamper-evident audit chain, so "unchanged since processing" can be shown later.
      await this.audit(institutionId, "system", "transcript.fingerprinted", `${lectureId} sha256:${transcriptDigest(result.transcript)}`);
      const stored = await this.repo.saveAssets(institutionId, lectureId, result.assets);
      await this.repo.saveChunks(institutionId, courseId, result.chunks);
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
    if (!asset) throw new NotFoundError(`Asset ${assetId} not found`);
    await this.repo.setAssetStatus(institutionId, assetId, "approved");
    await this.audit(institutionId, actor.id, "asset.approved", assetId);
    return { ...asset, status: "approved" };
  }

  /**
   * What a viewer is allowed to see: approved assets only, and only from a
   * course they can access. A lecture in a course the actor can't reach is
   * reported as NotFound, exactly like one that doesn't exist, so its
   * existence isn't revealed to someone who isn't enrolled.
   */
  async studentAssets(institutionId: string, lectureId: string, actor: Actor): Promise<StoredAsset[]> {
    const lecture = await this.repo.getLecture(institutionId, lectureId);
    if (!lecture || !(await this.canAccessCourse(institutionId, lecture.courseId, actor))) {
      throw new NotFoundError(`Lecture ${lectureId} not found`);
    }
    const assets = await this.repo.listAssets(institutionId, lectureId);
    return assets.filter((a) => a.status === "approved");
  }

  /**
   * The transcript behind a lecture, for the transcript page and the caption
   * (SRT/VTT/TXT) downloads: the accessibility surface universities are
   * required to provide.
   *
   * The raw transcript is unreviewed speech recognition, so it follows the
   * same release rule as everything else: staff (faculty/TA/admin) can always
   * see it; anyone else (students, auditors) only once the lecture has had at
   * least one asset approved and released. Throws NotFoundError when there is
   * nothing to show and AuthorizationError when it isn't released yet — the
   * checks live here, not in a page, so every delivery surface gets them.
   * Exports are audited (a transcript can contain student speech).
   */
  async getTranscript(
    institutionId: string,
    lectureId: string,
    actor: Actor,
    purpose: "view" | "export" = "view",
  ): Promise<Transcript> {
    const lecture = await this.repo.getLecture(institutionId, lectureId);
    if (!lecture || !(await this.canAccessCourse(institutionId, lecture.courseId, actor))) {
      throw new NotFoundError(`Lecture ${lectureId} not found`);
    }
    const transcript = await this.repo.getTranscript(institutionId, lectureId);
    if (!transcript) throw new NotFoundError(`No transcript for ${lectureId} yet`);

    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      const assets = await this.repo.listAssets(institutionId, lectureId);
      if (!assets.some((a) => a.status === "approved")) {
        throw new AuthorizationError(`The transcript for ${lectureId} has not been released yet.`);
      }
    }
    if (purpose === "export") {
      await this.audit(institutionId, actor.id, "transcript.exported", lectureId);
    }
    return transcript;
  }

  /**
   * Every action item across the workspace's approved meetings, with its
   * progress. Only items from an APPROVED actions asset appear, for everyone:
   * the tracker never surfaces AI output nobody has released. Newest meeting
   * first, items in the order they were said.
   */
  async listActionItems(institutionId: string, courseId: string, actor: Actor): Promise<TrackedAction[]> {
    if (!(await this.canAccessCourse(institutionId, courseId, actor))) throw new NotFoundError(`Course ${courseId} not found`);
    const statuses = new Map<string, ActionStatus>(
      (await this.repo.listActionStatuses(institutionId)).map((st) => [`${st.lectureId}#${st.itemIndex}`, st]),
    );
    const lectures = (await this.repo.listLecturesByCourse(institutionId, courseId))
      .filter((l) => l.status === "processed")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const out: TrackedAction[] = [];
    for (const l of lectures) {
      const asset = (await this.repo.listAssets(institutionId, l.id)).find((a) => a.type === "actions" && a.status === "approved");
      if (!asset) continue;
      (asset.content as ActionsAndDecisions).actionItems.forEach((item, index) => {
        const st = statuses.get(`${l.id}#${index}`);
        out.push({
          lectureId: l.id,
          index,
          text: item.statement.text,
          speaker: item.owner,
          assignee: st?.assignee ?? null,
          done: st?.done ?? false,
          confidence: item.statement.confidence,
          flagged: item.statement.flagged,
          sourceRefs: item.statement.sourceRefs,
          lectureCreatedAt: l.createdAt,
          updatedBy: st?.updatedBy ?? null,
          updatedAt: st?.updatedAt ?? null,
        });
      });
    }
    return out;
  }

  /**
   * Assign an action item, and/or mark it done or reopen it. Staff only (the
   * people who release material also run the follow-through); everyone else
   * can read the tracker. Each change is audited. Only items from an approved
   * actions asset can be touched, so nothing unreleased gets a status.
   */
  async updateActionItem(
    institutionId: string,
    lectureId: string,
    index: number,
    patch: { done?: boolean; assignee?: string | null },
    actor: Actor,
  ): Promise<void> {
    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      throw new AuthorizationError(`Role ${actor.role} cannot update action items.`);
    }
    let assignee: string | null | undefined;
    if (patch.assignee !== undefined) {
      const cleaned = (patch.assignee ?? "").trim().replace(/\s+/g, " ");
      if (cleaned.length > 80) throw new ValidationError("Keep the assignee's name under 80 characters.");
      assignee = cleaned === "" ? null : cleaned;
    }
    if (patch.done === undefined && assignee === undefined) throw new ValidationError("Nothing to update.");

    if (!(await this.repo.getLecture(institutionId, lectureId))) throw new NotFoundError(`Lecture ${lectureId} not found`);
    const asset = (await this.repo.listAssets(institutionId, lectureId)).find((a) => a.type === "actions" && a.status === "approved");
    const count = asset ? (asset.content as ActionsAndDecisions).actionItems.length : 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new NotFoundError(`No released action item ${index + 1} for ${lectureId}`);
    }

    const prev = (await this.repo.listActionStatuses(institutionId)).find((st) => st.lectureId === lectureId && st.itemIndex === index);
    const next: ActionStatus = {
      institutionId,
      lectureId,
      itemIndex: index,
      done: patch.done ?? prev?.done ?? false,
      assignee: assignee !== undefined ? assignee : (prev?.assignee ?? null),
      updatedBy: actor.id,
      updatedAt: new Date().toISOString(),
    };
    await this.repo.upsertActionStatus(next);

    const target = `${lectureId}#${index + 1}`;
    if (next.done !== (prev?.done ?? false)) {
      await this.audit(institutionId, actor.id, next.done ? "action_item.completed" : "action_item.reopened", target);
    }
    if (next.assignee !== (prev?.assignee ?? null)) {
      await this.audit(institutionId, actor.id, "action_item.assigned", `${target}: ${next.assignee ?? "unassigned"}`);
    }
  }

  // ── courses ───────────────────────────────────────────────────────

  /**
   * The course everyone in the organisation can always see: the one it was
   * created with (or, for an organisation with no profile such as the shared
   * demo, its first). Keeping this implicit is what lets an organisation that
   * existed before multi-course support carry on working unchanged, with no
   * enrolment data to migrate.
   */
  async defaultCourseId(institutionId: string): Promise<string | null> {
    const profile = await this.repo.getOrgProfile(institutionId);
    if (profile) return profile.courseId;
    return (await this.repo.listCourses(institutionId))[0]?.id ?? null;
  }

  /**
   * May this actor read this course's released material? Staff (faculty, TA,
   * admin) can reach every course in their organisation, since there is no
   * per-course staff assignment yet. Anyone else needs the course to be live
   * and either to be the organisation's default course or to have enrolled.
   * A course in another organisation is never accessible.
   */
  async canAccessCourse(institutionId: string, courseId: string, actor: Actor): Promise<boolean> {
    const course = await this.repo.getCourse(institutionId, courseId);
    if (!course) return false;
    if (isStaff(actor.role)) return true;
    if (course.archived) return false;
    if (courseId === (await this.defaultCourseId(institutionId))) return true;
    return (await this.repo.listMemberCourseIds(institutionId, actor.id)).includes(courseId);
  }

  /** The courses this actor can switch to, in creation order. Non-staff never see archived courses. */
  async accessibleCourses(institutionId: string, actor: Actor): Promise<Course[]> {
    const all = await this.repo.listCourses(institutionId);
    if (isStaff(actor.role)) return all;
    const def = await this.defaultCourseId(institutionId);
    const mine = new Set(await this.repo.listMemberCourseIds(institutionId, actor.id));
    return all.filter((c) => !c.archived && (c.id === def || mine.has(c.id)));
  }

  private cleanCourseFields(input: { code?: string; title?: string; externalId?: string | null }): CoursePatch {
    const out: CoursePatch = {};
    if (input.code !== undefined) {
      const code = input.code.trim().replace(/\s+/g, " ");
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,23}$/.test(code)) {
        throw new ValidationError("The code is 1-24 characters: letters, digits, spaces, dot, dash or underscore (for example CS101).");
      }
      out.code = code;
    }
    if (input.title !== undefined) {
      const title = input.title.trim().replace(/\s+/g, " ");
      if (title.length < 1 || title.length > 80) throw new ValidationError("The title is 1-80 characters.");
      out.title = title;
    }
    if (input.externalId !== undefined) {
      const ext = (input.externalId ?? "").trim();
      if (ext.length > 120) throw new ValidationError("Keep the external id under 120 characters.");
      out.externalId = ext === "" ? null : ext;
    }
    return out;
  }

  private async uniqueJoinCode(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = newCourseCode();
      if (!(await this.repo.getCourseByJoinCode(code))) return code;
    }
    throw new Error("Could not generate a unique join code");
  }

  private async assertCodeFree(institutionId: string, code: string, exceptId?: string): Promise<void> {
    const clash = (await this.repo.listCourses(institutionId)).find((c) => c.id !== exceptId && c.code.toLowerCase() === code.toLowerCase());
    if (clash) throw new ConflictError(`A course with the code ${code} already exists.`);
  }

  /** Create a course. Faculty and admins only. Staff can reach it immediately; students enrol with its join code. */
  async createCourse(
    institutionId: string,
    input: { code: string; title: string; externalId?: string },
    actor: Actor,
  ): Promise<Course> {
    if (!COURSE_MANAGERS.includes(actor.role)) throw new AuthorizationError(`Role ${actor.role} cannot create courses.`);
    if (!(await this.repo.getInstitution(institutionId))) throw new NotFoundError(`Unknown organisation ${institutionId}`);
    const f = this.cleanCourseFields({ code: input.code, title: input.title, externalId: input.externalId ?? "" });
    await this.assertCodeFree(institutionId, f.code!);
    const id = `course-${randomBytes(6).toString("hex")}`;
    await this.repo.upsertCourse({
      id,
      institutionId,
      code: f.code!,
      title: f.title!,
      joinCode: await this.uniqueJoinCode(),
      externalId: f.externalId ?? null,
      archived: false,
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    });
    await this.audit(institutionId, actor.id, "course.created", `${id}: ${f.code}`);
    return (await this.repo.getCourse(institutionId, id))!;
  }

  /** Rename a course or change its code / external id. Faculty and admins only. */
  async updateCourse(
    institutionId: string,
    courseId: string,
    input: { code?: string; title?: string; externalId?: string | null },
    actor: Actor,
  ): Promise<void> {
    if (!COURSE_MANAGERS.includes(actor.role)) throw new AuthorizationError(`Role ${actor.role} cannot edit courses.`);
    if (!(await this.repo.getCourse(institutionId, courseId))) throw new NotFoundError(`Course ${courseId} not found`);
    const f = this.cleanCourseFields(input);
    if (f.code !== undefined) await this.assertCodeFree(institutionId, f.code, courseId);
    await this.repo.updateCourse(institutionId, courseId, f);
    await this.audit(institutionId, actor.id, "course.updated", courseId);
  }

  /**
   * Archive (hide from students, stop new enrolment) or restore a course.
   * Admin only. The organisation's main course can't be archived: it is the one
   * everyone can always reach, and archiving it would lock students out of everything.
   */
  async setCourseArchived(institutionId: string, courseId: string, archived: boolean, actor: Actor): Promise<void> {
    if (actor.role !== "admin") throw new AuthorizationError(`Role ${actor.role} cannot archive courses.`);
    if (!(await this.repo.getCourse(institutionId, courseId))) throw new NotFoundError(`Course ${courseId} not found`);
    if (archived && courseId === (await this.defaultCourseId(institutionId))) {
      throw new ConflictError("The organisation's main course can't be archived: it is the one everyone can always reach.");
    }
    await this.repo.updateCourse(institutionId, courseId, { archived });
    await this.audit(institutionId, actor.id, archived ? "course.archived" : "course.restored", courseId);
  }

  /**
   * The code students use to enrol. Staff can read it; faculty and admins can
   * replace it (a code that has leaked can then be revoked). A course made
   * before codes existed gets one the first time it's asked for.
   */
  async courseJoinCode(institutionId: string, courseId: string, actor: Actor, regenerate = false): Promise<string> {
    if (!isStaff(actor.role)) throw new AuthorizationError(`Role ${actor.role} cannot see course join codes.`);
    if (regenerate && !COURSE_MANAGERS.includes(actor.role)) throw new AuthorizationError(`Role ${actor.role} cannot replace a join code.`);
    const course = await this.repo.getCourse(institutionId, courseId);
    if (!course) throw new NotFoundError(`Course ${courseId} not found`);
    if (course.joinCode && !regenerate) return course.joinCode;
    const code = await this.uniqueJoinCode();
    await this.repo.updateCourse(institutionId, courseId, { joinCode: code });
    await this.audit(institutionId, actor.id, regenerate ? "course.join_code_replaced" : "course.join_code_created", courseId);
    return code;
  }

  /**
   * Enrol the actor in the course the code belongs to. Anything wrong with the
   * code (unknown, another organisation's, archived, empty) gets the same
   * answer, so a guess reveals nothing about which codes exist.
   */
  async joinCourse(institutionId: string, rawCode: string, actor: Actor): Promise<Course> {
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const refuse = () => new ValidationError("That code isn't valid. Check it with your instructor.");
    if (!code) throw refuse();
    const course = await this.repo.getCourseByJoinCode(code);
    if (!course || course.institutionId !== institutionId || course.archived) throw refuse();
    const already = (await this.repo.listMemberCourseIds(institutionId, actor.id)).includes(course.id);
    if (!already) {
      await this.repo.addCourseMember({ institutionId, courseId: course.id, userId: actor.id, enrolledAt: new Date().toISOString() });
      await this.audit(institutionId, actor.id, "course.joined", course.id);
    }
    return course;
  }

  /** Who has enrolled in a course (staff only). People who can see it without enrolling (staff, and everyone for the main course) aren't listed. */
  async courseRoster(
    institutionId: string,
    courseId: string,
    actor: Actor,
  ): Promise<Array<{ userId: string; name: string | null; email: string | null; enrolledAt: string }>> {
    if (!isStaff(actor.role)) throw new AuthorizationError(`Role ${actor.role} cannot see a course roster.`);
    if (!(await this.repo.getCourse(institutionId, courseId))) throw new NotFoundError(`Course ${courseId} not found`);
    const people = new Map((await this.repo.listUsers(institutionId)).map((u) => [u.id, u]));
    return (await this.repo.listCourseMembers(institutionId, courseId)).map((m) => ({
      userId: m.userId,
      name: people.get(m.userId)?.name ?? null,
      email: people.get(m.userId)?.email ?? null,
      enrolledAt: m.enrolledAt,
    }));
  }

  /** Un-enrol someone. Faculty and admins only. They lose access straight away; the join code still works if they have it. */
  async removeCourseMember(institutionId: string, courseId: string, userId: string, actor: Actor): Promise<void> {
    if (!COURSE_MANAGERS.includes(actor.role)) throw new AuthorizationError(`Role ${actor.role} cannot remove people from a course.`);
    if (!(await this.repo.getCourse(institutionId, courseId))) throw new NotFoundError(`Course ${courseId} not found`);
    await this.repo.removeCourseMember(institutionId, courseId, userId);
    await this.audit(institutionId, actor.id, "course.member_removed", `${courseId}: ${userId}`);
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
    actor: Actor,
    query: string,
    topK = 3,
  ): Promise<SearchHit[]> {
    if (!(await this.canAccessCourse(institutionId, courseId, actor))) throw new NotFoundError(`Course ${courseId} not found`);
    const chunks = await this.repo.listCourseChunks(institutionId, courseId);
    const embeddings = getEmbeddingsProvider();
    await this.audit(institutionId, actor.id, "course.search", courseId);
    return search(embeddings, chunks, query, topK);
  }

  /** Right-to-erasure. Faculty/TA/admin only. Removes all derived data. */
  async deleteLecture(institutionId: string, lectureId: string, actor: Actor): Promise<void> {
    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      throw new AuthorizationError(`Role ${actor.role} cannot delete lectures.`);
    }
    const lecture = await this.repo.getLecture(institutionId, lectureId);
    if (!lecture) throw new NotFoundError(`Lecture ${lectureId} not found`);
    // A preservation order outranks an erasure request: deleting held material
    // is spoliation. The hold has to be released (by an admin) first.
    if (lecture.hold) {
      throw new ComplianceError(
        `${lectureId} is under legal hold ("${lecture.hold.reason}") and cannot be deleted. An administrator must release the hold first.`,
      );
    }
    await this.repo.deleteLecture(institutionId, lectureId);
    await this.audit(institutionId, actor.id, "lecture.deleted", lectureId);
  }

  /**
   * Place a legal hold: the recording and everything derived from it can no
   * longer be deleted by hand or purged by retention. Any staff role can place
   * one (preserving is the safe direction, and counsel shouldn't wait on an
   * admin); only an admin can release it. The reason is kept in the audit
   * trail too, so it survives the hold being released.
   */
  async placeLegalHold(institutionId: string, lectureId: string, reason: string, actor: Actor): Promise<void> {
    if (!["faculty", "ta", "admin"].includes(actor.role)) {
      throw new AuthorizationError(`Role ${actor.role} cannot place a legal hold.`);
    }
    const why = reason.trim().replace(/\s+/g, " ");
    if (why.length === 0) throw new ValidationError("A legal hold needs a reason (for example the matter or case reference).");
    if (why.length > 300) throw new ValidationError("Keep the reason under 300 characters.");
    const lecture = await this.repo.getLecture(institutionId, lectureId);
    if (!lecture) throw new NotFoundError(`Lecture ${lectureId} not found`);
    if (lecture.hold) throw new ConflictError(`${lectureId} is already under legal hold.`);
    await this.repo.setLegalHold(institutionId, lectureId, { reason: why, by: actor.id, at: new Date().toISOString() });
    await this.audit(institutionId, actor.id, "legal_hold.placed", `${lectureId}: ${why}`);
  }

  /** Release a legal hold. Admin only: lifting a preservation order is the risky direction. */
  async releaseLegalHold(institutionId: string, lectureId: string, actor: Actor): Promise<void> {
    if (actor.role !== "admin") {
      throw new AuthorizationError(`Role ${actor.role} cannot release a legal hold; ask an administrator.`);
    }
    const lecture = await this.repo.getLecture(institutionId, lectureId);
    if (!lecture) throw new NotFoundError(`Lecture ${lectureId} not found`);
    if (!lecture.hold) throw new ConflictError(`${lectureId} is not under legal hold.`);
    await this.repo.setLegalHold(institutionId, lectureId, null);
    await this.audit(institutionId, actor.id, "legal_hold.released", lectureId);
  }

  /**
   * The audit trail, with a verdict on whether it has been tampered with.
   * Admin and auditor only (the same people who can open the audit page).
   */
  async auditTrail(institutionId: string, actor: Actor): Promise<{ events: AuditEvent[]; verification: ChainVerification }> {
    if (actor.role !== "admin" && actor.role !== "auditor") {
      throw new AuthorizationError(`Role ${actor.role} cannot read the audit trail.`);
    }
    const events = await this.repo.listAudit(institutionId);
    return { events, verification: verifyChain(events, config.security.auditKey || undefined) };
  }

  /** Same as `auditTrail`, and records that the trail was exported (after taking the snapshot, so the export does not contain itself). */
  async exportAuditTrail(institutionId: string, actor: Actor): Promise<{ events: AuditEvent[]; verification: ChainVerification }> {
    const trail = await this.auditTrail(institutionId, actor);
    await this.audit(institutionId, actor.id, "audit.exported", institutionId);
    return trail;
  }

  /**
   * Is the stored transcript still the one that was produced? Compares it with
   * the fingerprint recorded in the audit chain at processing time. Anyone who
   * may view the transcript may check it. `auditChainOk` says whether the
   * record being compared against can itself be trusted.
   */
  async verifyTranscriptIntegrity(
    institutionId: string,
    lectureId: string,
    actor: Actor,
  ): Promise<{ status: "match" | "mismatch" | "no_record"; recorded?: string; current: string; auditChainOk: boolean }> {
    const transcript = await this.getTranscript(institutionId, lectureId, actor, "view");
    const current = transcriptDigest(transcript);
    const events = await this.repo.listAudit(institutionId);
    const auditChainOk = verifyChain(events, config.security.auditKey || undefined).ok;
    const prefix = `${lectureId} sha256:`;
    const rec = [...events].reverse().find((e) => e.action === "transcript.fingerprinted" && e.target.startsWith(prefix));
    if (!rec) return { status: "no_record", current, auditChainOk };
    const recorded = rec.target.slice(prefix.length);
    return { status: recorded === current ? "match" : "mismatch", recorded, current, auditChainOk };
  }

  /**
   * Retention enforcement (moat #2). Deletes lectures older than the tenant's
   * retentionDays. Admin only. `now` is injected for testability.
   */
  async runRetention(institutionId: string, actor: Actor, now: Date = new Date()): Promise<number> {
    return (await this.runRetentionDetailed(institutionId, actor, now)).purged;
  }

  /** Retention, reporting what it left alone: lectures under legal hold are never purged, however old. */
  async runRetentionDetailed(
    institutionId: string,
    actor: Actor,
    now: Date = new Date(),
  ): Promise<{ purged: number; heldSkipped: number }> {
    if (actor.role !== "admin") {
      throw new AuthorizationError(`Role ${actor.role} cannot run retention.`);
    }
    const inst = await this.repo.getInstitution(institutionId);
    if (!inst) throw new Error(`Unknown institution ${institutionId}`);
    const cutoff = new Date(now.getTime() - inst.retentionDays * 86_400_000).toISOString();
    let purged = 0;
    let heldSkipped = 0;
    for (const l of await this.repo.listLectures(institutionId)) {
      if (l.createdAt >= cutoff) continue;
      if (l.hold) {
        heldSkipped++;
        await this.audit(institutionId, actor.id, "retention.skipped_legal_hold", l.id);
        continue;
      }
      await this.repo.deleteLecture(institutionId, l.id);
      await this.audit(institutionId, actor.id, "lecture.purged", l.id);
      purged++;
    }
    return { purged, heldSkipped };
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
      if (a.type === "quiz") {
        return {
          lectureId,
          type: "quiz",
          title: `${lectureId} — Quiz`,
          body: quizToMarkdown(lectureId, a.content as Quiz),
          contentType: "text/markdown",
        };
      }
      return {
        lectureId,
        type: "actions",
        title: `${lectureId} — Decisions & Action Items`,
        body: actionsToMarkdown(lectureId, a.content as ActionsAndDecisions),
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
