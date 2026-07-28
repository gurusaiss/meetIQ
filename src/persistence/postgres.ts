/**
 * Postgres + pgvector adapter for the Repository port — the production
 * target from Phase 10 (docs/DECISIONS.md). Same interface as the SQLite
 * adapter (ports-and-adapters): the rest of the app cannot tell which one
 * it's talking to.
 *
 * Embeddings are stored in a real pgvector `vector` column (not inert JSON
 * like the SQLite adapter), so this adapter is the one that actually
 * exercises the extension — proving it's wired, not just present in
 * docker-compose. The vector dimension must match whatever embeddings
 * provider is configured (256 for the built-in mock provider); pgvector
 * requires a fixed dimension per column, declared at schema-creation time.
 *
 * Retrieval-time ranking is still done in `pipeline/rag.ts` (in-app cosine
 * over the chunks `listCourseChunks` returns) — this adapter proves pgvector
 * storage/round-tripping works correctly. Pushing the `<=>` operator into a
 * dedicated `searchChunks` port method (so Postgres does the ANN ranking) is
 * a documented follow-up, not done here, since it would change the
 * Repository interface's contract for both adapters.
 */
import pg from "pg";
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

const { Pool } = pg;

function schema(vectorDim: number): string {
  return `
CREATE EXTENSION IF NOT EXISTS vector;

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
  notice_shown BOOLEAN, opt_outs TEXT
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
  text TEXT, segment_ids TEXT, start_sec REAL, embedding VECTOR(${vectorDim})
);
CREATE TABLE IF NOT EXISTS audit (
  institution_id TEXT, actor TEXT, action TEXT, target TEXT, ts TEXT
);
CREATE INDEX IF NOT EXISTS idx_lectures_tenant ON lectures(institution_id);
CREATE INDEX IF NOT EXISTS idx_assets_lecture ON assets(institution_id, lecture_id);
CREATE INDEX IF NOT EXISTS idx_chunks_course ON chunks(institution_id, course_id);
`;
}

/** `[1,2,3]` <-> pgvector's textual representation. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
function fromVectorLiteral(raw: string): number[] {
  return raw
    .slice(1, -1)
    .split(",")
    .filter((s) => s.length > 0)
    .map(Number);
}

export interface PostgresRepositoryOptions {
  connectionString: string;
  /** Must match the configured embeddings provider's output dimension. */
  vectorDim?: number;
}

export class PostgresRepository implements Repository {
  private pool: InstanceType<typeof Pool>;
  private ready: Promise<void>;

  constructor(opts: PostgresRepositoryOptions) {
    this.pool = new Pool({ connectionString: opts.connectionString });
    this.ready = this.pool.query(schema(opts.vectorDim ?? 256)).then(() => undefined);
  }

  private async q<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await this.ready;
    const res = await this.pool.query(text, params);
    return res.rows as T[];
  }

  async upsertInstitution(i: Institution): Promise<void> {
    await this.q(
      `INSERT INTO institutions (id,name,consent_policy,data_region,retention_days)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name,
         consent_policy=excluded.consent_policy, data_region=excluded.data_region,
         retention_days=excluded.retention_days`,
      [i.id, i.name, i.consentPolicy, i.dataRegion, i.retentionDays],
    );
  }

  async getInstitution(id: string): Promise<Institution | null> {
    const rows = await this.q(`SELECT * FROM institutions WHERE id=$1`, [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id as string,
      name: r.name as string,
      consentPolicy: r.consent_policy as Institution["consentPolicy"],
      dataRegion: r.data_region as string,
      retentionDays: r.retention_days as number,
    };
  }

  async upsertCourse(c: Course): Promise<void> {
    await this.q(
      `INSERT INTO courses (id,institution_id,code,title) VALUES ($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, title=excluded.title`,
      [c.id, c.institutionId, c.code, c.title],
    );
  }

  async createLecture(l: Lecture): Promise<void> {
    await this.q(
      `INSERT INTO lectures (id,institution_id,course_id,media_ref,status,capture_source,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [l.id, l.institutionId, l.courseId, l.mediaRef, l.status, l.captureSource, l.createdAt],
    );
  }

  async setLectureStatus(institutionId: string, lectureId: string, status: LectureStatus): Promise<void> {
    await this.q(`UPDATE lectures SET status=$1 WHERE id=$2 AND institution_id=$3`, [
      status,
      lectureId,
      institutionId,
    ]);
  }

  async listLecturesByCourse(institutionId: string, courseId: string): Promise<Lecture[]> {
    const rows = await this.q(
      `SELECT * FROM lectures WHERE course_id=$1 AND institution_id=$2 ORDER BY created_at`,
      [courseId, institutionId],
    );
    return rows.map(rowToLecture);
  }

  async listLectures(institutionId: string): Promise<Lecture[]> {
    const rows = await this.q(`SELECT * FROM lectures WHERE institution_id=$1 ORDER BY created_at`, [
      institutionId,
    ]);
    return rows.map(rowToLecture);
  }

  async deleteLecture(institutionId: string, lectureId: string): Promise<void> {
    for (const table of ["assets", "chunks", "transcripts", "consent", "lectures"]) {
      const col = table === "lectures" ? "id" : "lecture_id";
      await this.q(`DELETE FROM ${table} WHERE ${col}=$1 AND institution_id=$2`, [
        lectureId,
        institutionId,
      ]);
    }
  }

  async getLecture(institutionId: string, lectureId: string): Promise<Lecture | null> {
    const rows = await this.q(`SELECT * FROM lectures WHERE id=$1 AND institution_id=$2`, [
      lectureId,
      institutionId,
    ]);
    return rows[0] ? rowToLecture(rows[0]) : null;
  }

  async saveConsent(c: ConsentRecord): Promise<void> {
    await this.q(
      `INSERT INTO consent (lecture_id,institution_id,policy,notice_shown,opt_outs)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(lecture_id) DO UPDATE SET policy=excluded.policy,
         notice_shown=excluded.notice_shown, opt_outs=excluded.opt_outs`,
      [c.lectureId, c.institutionId, c.policy, c.noticeShown, JSON.stringify(c.optOuts)],
    );
  }

  async getConsent(institutionId: string, lectureId: string): Promise<ConsentRecord | null> {
    const rows = await this.q(`SELECT * FROM consent WHERE lecture_id=$1 AND institution_id=$2`, [
      lectureId,
      institutionId,
    ]);
    const r = rows[0];
    if (!r) return null;
    return {
      lectureId: r.lecture_id as string,
      institutionId: r.institution_id as string,
      policy: r.policy as ConsentRecord["policy"],
      noticeShown: r.notice_shown as boolean,
      optOuts: JSON.parse((r.opt_outs as string) || "[]") as string[],
    };
  }

  async saveTranscript(institutionId: string, t: Transcript): Promise<void> {
    await this.q(
      `INSERT INTO transcripts (lecture_id,institution_id,language,provider,segments)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(lecture_id) DO UPDATE SET language=excluded.language,
         provider=excluded.provider, segments=excluded.segments`,
      [t.lectureId, institutionId, t.language, t.provider, JSON.stringify(t.segments)],
    );
  }

  async getTranscript(institutionId: string, lectureId: string): Promise<Transcript | null> {
    const rows = await this.q(`SELECT * FROM transcripts WHERE lecture_id=$1 AND institution_id=$2`, [
      lectureId,
      institutionId,
    ]);
    const r = rows[0];
    if (!r) return null;
    return {
      lectureId: r.lecture_id as string,
      language: r.language as string,
      provider: r.provider as string,
      segments: JSON.parse(r.segments as string),
    };
  }

  async saveAssets(
    institutionId: string,
    lectureId: string,
    assets: KnowledgeAsset[],
  ): Promise<StoredAsset[]> {
    const stored: StoredAsset[] = [];
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i]!;
      const id = `${lectureId}:${a.type}:${i}`;
      await this.q(
        `INSERT INTO assets (id,institution_id,lecture_id,type,status,content,flag_ratio,ungrounded_ratio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, institutionId, lectureId, a.type, a.status, JSON.stringify(a.content), a.flagRatio, a.ungroundedRatio],
      );
      stored.push({ ...a, id, lectureId, institutionId });
    }
    return stored;
  }

  async getAsset(institutionId: string, assetId: string): Promise<StoredAsset | null> {
    const rows = await this.q(`SELECT * FROM assets WHERE id=$1 AND institution_id=$2`, [
      assetId,
      institutionId,
    ]);
    return rows[0] ? rowToAsset(rows[0]) : null;
  }

  async listAssets(institutionId: string, lectureId: string): Promise<StoredAsset[]> {
    const rows = await this.q(`SELECT * FROM assets WHERE lecture_id=$1 AND institution_id=$2`, [
      lectureId,
      institutionId,
    ]);
    return rows.map(rowToAsset);
  }

  async setAssetStatus(institutionId: string, assetId: string, status: AssetStatus): Promise<void> {
    await this.q(`UPDATE assets SET status=$1 WHERE id=$2 AND institution_id=$3`, [
      status,
      assetId,
      institutionId,
    ]);
  }

  async saveChunks(institutionId: string, courseId: string, chunks: Chunk[]): Promise<void> {
    for (const c of chunks) {
      await this.q(
        `INSERT INTO chunks (id,institution_id,lecture_id,course_id,text,segment_ids,start_sec,embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
         ON CONFLICT(id) DO UPDATE SET text=excluded.text, embedding=excluded.embedding`,
        [
          c.id,
          institutionId,
          c.lectureId,
          courseId,
          c.text,
          JSON.stringify(c.segmentIds),
          c.start,
          toVectorLiteral(c.embedding),
        ],
      );
    }
  }

  async listCourseChunks(institutionId: string, courseId: string): Promise<Chunk[]> {
    const rows = await this.q(
      `SELECT id, lecture_id, text, segment_ids, start_sec, embedding::text AS embedding
       FROM chunks WHERE course_id=$1 AND institution_id=$2`,
      [courseId, institutionId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      lectureId: r.lecture_id as string,
      text: r.text as string,
      segmentIds: JSON.parse(r.segment_ids as string),
      start: r.start_sec as number,
      embedding: fromVectorLiteral(r.embedding as string),
    }));
  }

  async audit(e: AuditEvent): Promise<void> {
    await this.q(`INSERT INTO audit (institution_id,actor,action,target,ts) VALUES ($1,$2,$3,$4,$5)`, [
      e.institutionId,
      e.actor,
      e.action,
      e.target,
      e.ts,
    ]);
  }

  async listAudit(institutionId: string): Promise<AuditEvent[]> {
    const rows = await this.q(`SELECT * FROM audit WHERE institution_id=$1 ORDER BY ts`, [
      institutionId,
    ]);
    return rows.map((r) => ({
      institutionId: r.institution_id as string,
      actor: r.actor as string,
      action: r.action as string,
      target: r.target as string,
      ts: r.ts as string,
    }));
  }

  async healthcheck(): Promise<boolean> {
    try {
      const rows = await this.q<{ ok: number }>("SELECT 1 AS ok");
      return rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function rowToLecture(r: Record<string, unknown>): Lecture {
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
