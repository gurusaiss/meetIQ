/**
 * Repository PORT (ports-and-adapters).
 *
 * The rest of the app depends only on this interface, never on a database.
 * Local/dev uses the zero-dependency SQLite adapter (built-in node:sqlite);
 * production swaps in a Postgres + pgvector adapter with the SAME interface.
 * This is the refinement of the Phase 10 decision — the stack choice becomes
 * an adapter detail, not a hard dependency of the domain.
 *
 * Every method is tenant-scoped by `institutionId` (moat #2 isolation): a
 * caller cannot read another institution's data even by guessing ids.
 *
 * Every method is async (Promise-returning). The SQLite adapter's underlying
 * calls are synchronous (node:sqlite), so it just wraps results in resolved
 * promises — but the interface must be async because a real production
 * adapter (Postgres over the network) cannot be synchronous, and the port
 * should not lie about that to its callers.
 */
import type { Transcript, KnowledgeAsset, Chunk, AssetStatus } from "../types.ts";

export interface Institution {
  id: string;
  name: string;
  consentPolicy: "single_party" | "all_party";
  dataRegion: string;
  retentionDays: number;
}

export interface Course {
  id: string;
  institutionId: string;
  code: string;
  title: string;
  /** The code students enter to enrol themselves. Absent on courses made before multi-course support. */
  joinCode?: string | null;
  /** This course's id in the capture system / LMS (a Canvas course id or SIS id, a Zoom user). */
  externalId?: string | null;
  /** Archived courses are hidden from, and can't be joined by, non-staff. */
  archived?: boolean;
  createdBy?: string | null;
  createdAt?: string | null;
}

export interface CourseMember {
  institutionId: string;
  courseId: string;
  userId: string;
  enrolledAt: string;
}

/** The fields of a course that can be edited after creation. */
export type CoursePatch = Partial<Pick<Course, "code" | "title" | "externalId" | "joinCode" | "archived">>;

export type LectureStatus =
  | "created"
  | "processing"
  | "processed"
  | "failed";

/** A preservation order: while set, the recording and everything derived from it cannot be deleted or purged. */
export interface LegalHold {
  reason: string;
  /** Actor id who placed it. */
  by: string;
  at: string;
}

export interface Lecture {
  id: string;
  institutionId: string;
  courseId: string;
  mediaRef: string;
  status: LectureStatus;
  captureSource: string;
  createdAt: string;
  /** Present only while the lecture is under legal hold. */
  hold?: LegalHold | undefined;
}

export interface ConsentRecord {
  lectureId: string;
  institutionId: string;
  policy: "single_party" | "all_party";
  noticeShown: boolean;
  optOuts: string[];
}

export interface StoredAsset extends KnowledgeAsset {
  id: string;
  lectureId: string;
  institutionId: string;
}

/**
 * Progress on one action item. Action items live inside an approved "actions"
 * asset, which never changes after it is stored, so an item's position in that
 * list is a stable key; this holds only what people do with it afterwards.
 */
export interface ActionStatus {
  institutionId: string;
  lectureId: string;
  /** Zero-based position in the asset's `actionItems`. */
  itemIndex: number;
  done: boolean;
  /** A real person, as typed by staff. The transcript's speaker label is not one. */
  assignee: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface AuditEvent {
  institutionId: string;
  actor: string;
  action: string;
  target: string;
  ts: string;
  /**
   * Tamper-evidence (see src/audit/chain.ts). Set by the adapter when the event
   * is appended, never by the caller; absent on events from before the chain.
   */
  hash?: string | null;
  prevHash?: string | null;
}

/** A sign-in account. `baseRole` is the permission role; `profile` is the sector-specific title. */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  institutionId: string;
  sector: string;
  profile: string;
  baseRole: "student" | "faculty" | "ta" | "admin" | "auditor";
  createdAt: string;
  /** Absent/false on an account made before email verification existed, and on every demo sign-in. */
  emailVerified?: boolean;
}

/** A single-use, time-limited token: an emailed link proving control of an inbox. The raw token is never stored, only its hash. */
export interface AuthToken {
  tokenHash: string;
  userId: string;
  kind: "verify_email" | "reset_password";
  expiresAt: string;
  usedAt?: string | null;
}

/** Sector, invite code and default course for one organisation (tenant). */
export interface OrgProfile {
  institutionId: string;
  sector: string;
  courseId: string;
  joinCode: string;
  ownerUserId: string;
  createdAt: string;
}

export interface Repository {
  // accounts & organisations
  createUser(u: UserRecord): Promise<void>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;
  setEmailVerified(userId: string, verified: boolean): Promise<void>;
  createAuthToken(t: AuthToken): Promise<void>;
  /** null if the token doesn't exist, is expired, or was already used — callers don't need to check those separately. */
  getValidAuthToken(tokenHash: string, kind: AuthToken["kind"]): Promise<AuthToken | null>;
  markAuthTokenUsed(tokenHash: string): Promise<void>;
  listUsers(institutionId: string): Promise<UserRecord[]>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  createOrgProfile(o: OrgProfile): Promise<void>;
  getOrgProfile(institutionId: string): Promise<OrgProfile | null>;
  getOrgByJoinCode(joinCode: string): Promise<OrgProfile | null>;

  // tenants & structure
  upsertInstitution(i: Institution): Promise<void>;
  getInstitution(id: string): Promise<Institution | null>;
  upsertCourse(c: Course): Promise<void>;
  getCourse(institutionId: string, courseId: string): Promise<Course | null>;
  /** In creation order. */
  listCourses(institutionId: string): Promise<Course[]>;
  /** Join codes are unique across the whole system, so this looks across organisations; callers must check the result's institution. */
  getCourseByJoinCode(joinCode: string): Promise<Course | null>;
  updateCourse(institutionId: string, courseId: string, patch: CoursePatch): Promise<void>;
  /** Idempotent: enrolling twice is a no-op. */
  addCourseMember(m: CourseMember): Promise<void>;
  removeCourseMember(institutionId: string, courseId: string, userId: string): Promise<void>;
  listCourseMembers(institutionId: string, courseId: string): Promise<CourseMember[]>;
  listMemberCourseIds(institutionId: string, userId: string): Promise<string[]>;

  // lectures
  createLecture(l: Lecture): Promise<void>;
  setLectureStatus(institutionId: string, lectureId: string, status: LectureStatus): Promise<void>;
  getLecture(institutionId: string, lectureId: string): Promise<Lecture | null>;
  listLecturesByCourse(institutionId: string, courseId: string): Promise<Lecture[]>;
  listLectures(institutionId: string): Promise<Lecture[]>;
  /** Right-to-erasure: removes the lecture and ALL derived data. */
  deleteLecture(institutionId: string, lectureId: string): Promise<void>;
  /** Place (`hold`) or release (`null`) a legal hold. The service decides who may; this just records it. */
  setLegalHold(institutionId: string, lectureId: string, hold: LegalHold | null): Promise<void>;

  // consent (moat #2)
  saveConsent(c: ConsentRecord): Promise<void>;
  getConsent(institutionId: string, lectureId: string): Promise<ConsentRecord | null>;

  // pipeline outputs
  saveTranscript(institutionId: string, t: Transcript): Promise<void>;
  getTranscript(institutionId: string, lectureId: string): Promise<Transcript | null>;

  saveAssets(institutionId: string, lectureId: string, assets: KnowledgeAsset[]): Promise<StoredAsset[]>;
  getAsset(institutionId: string, assetId: string): Promise<StoredAsset | null>;
  listAssets(institutionId: string, lectureId: string): Promise<StoredAsset[]>;
  listActionStatuses(institutionId: string): Promise<ActionStatus[]>;
  upsertActionStatus(s: ActionStatus): Promise<void>;
  setAssetStatus(institutionId: string, assetId: string, status: AssetStatus): Promise<void>;

  saveChunks(institutionId: string, courseId: string, chunks: Chunk[]): Promise<void>;
  /** All chunks for every lecture in a course — the RAG corpus for search. */
  listCourseChunks(institutionId: string, courseId: string): Promise<Chunk[]>;

  // compliance
  /** Append an event. The adapter chains it to the organisation's previous event, atomically. */
  audit(e: AuditEvent): Promise<void>;
  /** Oldest first, in the order events were appended (the chain order). */
  listAudit(institutionId: string): Promise<AuditEvent[]>;

  /** Liveness probe — true if the store answers a trivial query. */
  healthcheck(): Promise<boolean>;
  close(): Promise<void>;
}
