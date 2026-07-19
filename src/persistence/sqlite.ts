/**
 * SQLite adapter for the Repository port, on Node's built-in `node:sqlite`
 * (zero external dependencies). Suitable for local/dev and small pilots.
 * Embeddings are stored as JSON and searched in-app; the Postgres/pgvector
 * adapter (prod) will push vector search into the database instead.
 *
 * Tenant isolation is enforced in SQL: every read/write is filtered by
 * institution_id, so a wrong-tenant id simply returns nothing.
 */
import { DatabaseSync } from "node:sqlite";
import type {
  Transcript,
  KnowledgeAsset,
  Chunk,
  AssetStatus,
} from "../types.ts";
import type {
  Repository,
  Institution,
  Course,
  Lecture,
  LectureStatus,
  ConsentRecord,
  StoredAsset,
  AuditEvent,
} from "./repository.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY, name TEXT, consent_policy TEXT,
  data_region TEXT, retention_days INTEGER
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, institution_id TEXT, code TEXT, title TEXT
);
CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY, institution_id TEXT, course_id TEXT, media_ref TEXT,
  status TEXT, capture_source TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS consent (
  lecture_id TEXT PRIMARY KEY, institution_id TEXT, policy TEXT,
  notice_shown INTEGER, opt_outs TEXT
);
CREATE TABLE IF NOT EXISTS transcripts (
  lecture_id TEXT PRIMARY KEY, institution_id TEXT, language TEXT,
  provider TEXT, segments TEXT
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, institution_id TEXT, lecture_id TEXT, type TEXT,
  status TEXT, content TEXT, flag_ratio REAL, ungrounded_ratio REAL
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY, institution_id TEXT, lecture_id TEXT, course_id TEXT,
  text TEXT, segment_ids TEXT, start REAL, embedding TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  institution_id TEXT, actor TEXT, action TEXT, target TEXT, ts TEXT
);
CREATE INDEX IF NOT EXISTS idx_lectures_tenant ON lectures(institution_id);
CREATE INDEX IF NOT EXISTS idx_assets_lecture ON assets(institution_id, lecture_id);
CREATE INDEX IF NOT EXISTS idx_chunks_course ON chunks(institution_id, course_id);
`;

export class SqliteRepository implements Repository {
  private db: DatabaseSync;

  /** `path` defaults to in-memory; pass a file path to persist to disk. */
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  upsertInstitution(i: Institution): void {
    this.db
      .prepare(
        `INSERT INTO institutions (id,name,consent_policy,data_region,retention_days)
         VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,
           consent_policy=excluded.consent_policy, data_region=excluded.data_region,
           retention_days=excluded.retention_days`,
      )
      .run(i.id, i.name, i.consentPolicy, i.dataRegion, i.retentionDays);
  }

  getInstitution(id: string): Institution | null {
    const r = this.db
      .prepare(`SELECT * FROM institutions WHERE id=?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r.id as string,
      name: r.name as string,
      consentPolicy: r.consent_policy as Institution["consentPolicy"],
      dataRegion: r.data_region as string,
      retentionDays: r.retention_days as number,
    };
  }

  upsertCourse(c: Course): void {
    this.db
      .prepare(
        `INSERT INTO courses (id,institution_id,code,title) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET code=excluded.code, title=excluded.title`,
      )
      .run(c.id, c.institutionId, c.code, c.title);
  }

  createLecture(l: Lecture): void {
    this.db
      .prepare(
        `INSERT INTO lectures (id,institution_id,course_id,media_ref,status,capture_source,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        l.id,
        l.institutionId,
        l.courseId,
        l.mediaRef,
        l.status,
        l.captureSource,
        l.createdAt,
      );
  }

  setLectureStatus(institutionId: string, lectureId: string, status: LectureStatus): void {
    this.db
      .prepare(`UPDATE lectures SET status=? WHERE id=? AND institution_id=?`)
      .run(status, lectureId, institutionId);
  }

  getLecture(institutionId: string, lectureId: string): Lecture | null {
    const r = this.db
      .prepare(`SELECT * FROM lectures WHERE id=? AND institution_id=?`)
      .get(lectureId, institutionId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r.id as string,
      institutionId: r.institution_id as string,
      courseId: r.course_id as string,
      mediaRef: r.media_ref as string,
      status: r.status as LectureStatus,
      captureSource: r.capture_source as string,
      createdAt: r.created_at as string,
    };
  }

  saveConsent(c: ConsentRecord): void {
    this.db
      .prepare(
        `INSERT INTO consent (lecture_id,institution_id,policy,notice_shown,opt_outs)
         VALUES (?,?,?,?,?)
         ON CONFLICT(lecture_id) DO UPDATE SET policy=excluded.policy,
           notice_shown=excluded.notice_shown, opt_outs=excluded.opt_outs`,
      )
      .run(
        c.lectureId,
        c.institutionId,
        c.policy,
        c.noticeShown ? 1 : 0,
        JSON.stringify(c.optOuts),
      );
  }

  getConsent(institutionId: string, lectureId: string): ConsentRecord | null {
    const r = this.db
      .prepare(`SELECT * FROM consent WHERE lecture_id=? AND institution_id=?`)
      .get(lectureId, institutionId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      lectureId: r.lecture_id as string,
      institutionId: r.institution_id as string,
      policy: r.policy as ConsentRecord["policy"],
      noticeShown: (r.notice_shown as number) === 1,
      optOuts: JSON.parse((r.opt_outs as string) || "[]") as string[],
    };
  }

  saveTranscript(institutionId: string, t: Transcript): void {
    this.db
      .prepare(
        `INSERT INTO transcripts (lecture_id,institution_id,language,provider,segments)
         VALUES (?,?,?,?,?)
         ON CONFLICT(lecture_id) DO UPDATE SET language=excluded.language,
           provider=excluded.provider, segments=excluded.segments`,
      )
      .run(t.lectureId, institutionId, t.language, t.provider, JSON.stringify(t.segments));
  }

  getTranscript(institutionId: string, lectureId: string): Transcript | null {
    const r = this.db
      .prepare(`SELECT * FROM transcripts WHERE lecture_id=? AND institution_id=?`)
      .get(lectureId, institutionId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      lectureId: r.lecture_id as string,
      language: r.language as string,
      provider: r.provider as string,
      segments: JSON.parse(r.segments as string),
    };
  }

  saveAssets(
    institutionId: string,
    lectureId: string,
    assets: KnowledgeAsset[],
  ): StoredAsset[] {
    const stmt = this.db.prepare(
      `INSERT INTO assets (id,institution_id,lecture_id,type,status,content,flag_ratio,ungrounded_ratio)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    const stored: StoredAsset[] = [];
    assets.forEach((a, i) => {
      const id = `${lectureId}:${a.type}:${i}`;
      stmt.run(
        id,
        institutionId,
        lectureId,
        a.type,
        a.status,
        JSON.stringify(a.content),
        a.flagRatio,
        a.ungroundedRatio,
      );
      stored.push({ ...a, id, lectureId, institutionId });
    });
    return stored;
  }

  getAsset(institutionId: string, assetId: string): StoredAsset | null {
    const r = this.db
      .prepare(`SELECT * FROM assets WHERE id=? AND institution_id=?`)
      .get(assetId, institutionId) as Record<string, unknown> | undefined;
    return r ? rowToAsset(r) : null;
  }

  listAssets(institutionId: string, lectureId: string): StoredAsset[] {
    const rows = this.db
      .prepare(`SELECT * FROM assets WHERE lecture_id=? AND institution_id=?`)
      .all(lectureId, institutionId) as Record<string, unknown>[];
    return rows.map(rowToAsset);
  }

  setAssetStatus(institutionId: string, assetId: string, status: AssetStatus): void {
    this.db
      .prepare(`UPDATE assets SET status=? WHERE id=? AND institution_id=?`)
      .run(status, assetId, institutionId);
  }

  saveChunks(institutionId: string, courseId: string, chunks: Chunk[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO chunks (id,institution_id,lecture_id,course_id,text,segment_ids,start,embedding)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET text=excluded.text, embedding=excluded.embedding`,
    );
    for (const c of chunks) {
      stmt.run(
        c.id,
        institutionId,
        c.lectureId,
        courseId,
        c.text,
        JSON.stringify(c.segmentIds),
        c.start,
        JSON.stringify(c.embedding),
      );
    }
  }

  listCourseChunks(institutionId: string, courseId: string): Chunk[] {
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE course_id=? AND institution_id=?`)
      .all(courseId, institutionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      lectureId: r.lecture_id as string,
      text: r.text as string,
      segmentIds: JSON.parse(r.segment_ids as string),
      start: r.start as number,
      embedding: JSON.parse(r.embedding as string),
    }));
  }

  audit(e: AuditEvent): void {
    this.db
      .prepare(`INSERT INTO audit (institution_id,actor,action,target,ts) VALUES (?,?,?,?,?)`)
      .run(e.institutionId, e.actor, e.action, e.target, e.ts);
  }

  listAudit(institutionId: string): AuditEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit WHERE institution_id=? ORDER BY ts`)
      .all(institutionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      institutionId: r.institution_id as string,
      actor: r.actor as string,
      action: r.action as string,
      target: r.target as string,
      ts: r.ts as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function rowToAsset(r: Record<string, unknown>): StoredAsset {
  return {
    id: r.id as string,
    institutionId: r.institution_id as string,
    lectureId: r.lecture_id as string,
    type: r.type as KnowledgeAsset["type"],
    status: r.status as AssetStatus,
    content: JSON.parse(r.content as string),
    flagRatio: r.flag_ratio as number,
    ungroundedRatio: r.ungrounded_ratio as number,
  };
}
