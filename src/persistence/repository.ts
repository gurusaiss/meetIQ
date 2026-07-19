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
  upsertInstitution(i: Institution): void;
  getInstitution(id: string): Institution | null;
  upsertCourse(c: Course): void;

  // lectures
  createLecture(l: Lecture): void;
  setLectureStatus(institutionId: string, lectureId: string, status: LectureStatus): void;
  getLecture(institutionId: string, lectureId: string): Lecture | null;
  listLecturesByCourse(institutionId: string, courseId: string): Lecture[];
  listLectures(institutionId: string): Lecture[];
  /** Right-to-erasure: removes the lecture and ALL derived data. */
  deleteLecture(institutionId: string, lectureId: string): void;

  // consent (moat #2)
  saveConsent(c: ConsentRecord): void;
  getConsent(institutionId: string, lectureId: string): ConsentRecord | null;

  // pipeline outputs
  saveTranscript(institutionId: string, t: Transcript): void;
  getTranscript(institutionId: string, lectureId: string): Transcript | null;

  saveAssets(institutionId: string, lectureId: string, assets: KnowledgeAsset[]): StoredAsset[];
  getAsset(institutionId: string, assetId: string): StoredAsset | null;
  listAssets(institutionId: string, lectureId: string): StoredAsset[];
  setAssetStatus(institutionId: string, assetId: string, status: AssetStatus): void;

  saveChunks(institutionId: string, courseId: string, chunks: Chunk[]): void;
  /** All chunks for every lecture in a course — the RAG corpus for search. */
  listCourseChunks(institutionId: string, courseId: string): Chunk[];

  // compliance
  audit(e: AuditEvent): void;
  listAudit(institutionId: string): AuditEvent[];

  close(): void;
}
