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
}

export type LectureStatus =
  | "created"
  | "processing"
  | "processed"
  | "failed";

export interface Lecture {
  id: string;
  institutionId: string;
  courseId: string;
  mediaRef: string;
  status: LectureStatus;
  captureSource: string;
  createdAt: string;
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

export interface AuditEvent {
  institutionId: string;
  actor: string;
  action: string;
  target: string;
  ts: string;
}

export interface Repository {
  // tenants & structure
  upsertInstitution(i: Institution): Promise<void>;
  getInstitution(id: string): Promise<Institution | null>;
  upsertCourse(c: Course): Promise<void>;

  // lectures
  createLecture(l: Lecture): Promise<void>;
  setLectureStatus(institutionId: string, lectureId: string, status: LectureStatus): Promise<void>;
  getLecture(institutionId: string, lectureId: string): Promise<Lecture | null>;
  listLecturesByCourse(institutionId: string, courseId: string): Promise<Lecture[]>;
  listLectures(institutionId: string): Promise<Lecture[]>;
  /** Right-to-erasure: removes the lecture and ALL derived data. */
  deleteLecture(institutionId: string, lectureId: string): Promise<void>;

  // consent (moat #2)
  saveConsent(c: ConsentRecord): Promise<void>;
  getConsent(institutionId: string, lectureId: string): Promise<ConsentRecord | null>;

  // pipeline outputs
  saveTranscript(institutionId: string, t: Transcript): Promise<void>;
  getTranscript(institutionId: string, lectureId: string): Promise<Transcript | null>;

  saveAssets(institutionId: string, lectureId: string, assets: KnowledgeAsset[]): Promise<StoredAsset[]>;
  getAsset(institutionId: string, assetId: string): Promise<StoredAsset | null>;
  listAssets(institutionId: string, lectureId: string): Promise<StoredAsset[]>;
  setAssetStatus(institutionId: string, assetId: string, status: AssetStatus): Promise<void>;

  saveChunks(institutionId: string, courseId: string, chunks: Chunk[]): Promise<void>;
  /** All chunks for every lecture in a course — the RAG corpus for search. */
  listCourseChunks(institutionId: string, courseId: string): Promise<Chunk[]>;

  // compliance
  audit(e: AuditEvent): Promise<void>;
  listAudit(institutionId: string): Promise<AuditEvent[]>;

  /** Liveness probe — true if the store answers a trivial query. */
  healthcheck(): Promise<boolean>;
  close(): Promise<void>;
}
