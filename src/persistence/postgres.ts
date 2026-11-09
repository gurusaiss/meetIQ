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
  ActionStatus,
  CourseMember,
  CoursePatch,
  AuthToken,
  LegalHold,
  UserRecord,
  OrgProfile,
} from "./repository.ts";
import { eventHash, GENESIS } from "../audit/chain.ts";

const { Pool } = pg;

function schema(vectorDim: number): string {
  return `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY, name TEXT, consent_policy TEXT,
  data_region TEXT, retention_days INTEGER
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, institution_id TEXT, code TEXT, title TEXT,
  join_code TEXT, external_id TEXT, archived BOOLEAN, created_by TEXT, created_at TEXT,
  seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY, user_id TEXT, kind TEXT, expires_at TEXT, used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
CREATE TABLE IF NOT EXISTS course_members (
  institution_id TEXT, course_id TEXT, user_id TEXT, enrolled_at TEXT,
  PRIMARY KEY (course_id, user_id)
);
CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY, institution_id TEXT, course_id TEXT, media_ref TEXT,
  status TEXT, capture_source TEXT, created_at TEXT,
  hold_reason TEXT, hold_by TEXT, hold_at TEXT
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
CREATE TABLE IF NOT EXISTS action_status (
  institution_id TEXT, lecture_id TEXT, item_index INTEGER, done BOOLEAN,
  assignee TEXT, updated_by TEXT, updated_at TEXT,
  PRIMARY KEY (institution_id, lecture_id, item_index)
);
CREATE TABLE IF NOT EXISTS audit (
  institution_id TEXT, actor TEXT, action TEXT, target TEXT, ts TEXT,
  hash TEXT, prev_hash TEXT, seq BIGSERIAL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, password_hash TEXT,
  institution_id TEXT, sector TEXT, profile TEXT, base_role TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS org_profiles (
  institution_id TEXT PRIMARY KEY, sector TEXT, course_id TEXT,
  join_code TEXT UNIQUE, owner_user_id TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(institution_id);
CREATE INDEX IF NOT EXISTS idx_lectures_tenant ON lectures(institution_id);
CREATE INDEX IF NOT EXISTS idx_assets_lecture ON assets(institution_id, lecture_id);
CREATE INDEX IF NOT EXISTS idx_chunks_course ON chunks(institution_id, course_id);

-- Columns added after the first release. CREATE TABLE IF NOT EXISTS never alters
-- an existing table, so a database made by an older version needs these; each is
-- a no-op when the column is already there, so this is safe on every start.
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS hold_reason TEXT;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS hold_by TEXT;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS hold_at TEXT;
ALTER TABLE audit ADD COLUMN IF NOT EXISTS hash TEXT;
ALTER TABLE audit ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS join_code TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS archived BOOLEAN;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_at TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_join_code ON courses(join_code);
CREATE INDEX IF NOT EXISTS idx_audit_chain ON audit(institution_id, seq);
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
  /** HMAC key for the audit chain (AUDIT_CHAIN_KEY). Empty = plain SHA-256. */
  auditKey?: string;
}

export class PostgresRepository implements Repository {
  private pool: InstanceType<typeof Pool>;
  private ready: Promise<void>;
  private readonly auditKey: string | undefined;

  constructor(opts: PostgresRepositoryOptions) {
    this.auditKey = opts.auditKey || undefined;
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

  async createUser(u: UserRecord): Promise<void> {
    await this.q(
      `INSERT INTO users (id,email,name,password_hash,institution_id,sector,profile,base_role,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, u.email, u.name, u.passwordHash, u.institutionId, u.sector, u.profile, u.baseRole, u.createdAt],
    );
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const rows = await this.q(`SELECT * FROM users WHERE email=$1`, [email]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const rows = await this.q(`SELECT * FROM users WHERE id=$1`, [userId]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async setEmailVerified(userId: string, verified: boolean): Promise<void> {
    await this.q(`UPDATE users SET email_verified=$1 WHERE id=$2`, [verified, userId]);
  }

  async createAuthToken(t: AuthToken): Promise<void> {
    await this.q(`INSERT INTO auth_tokens (token_hash,user_id,kind,expires_at,used_at) VALUES ($1,$2,$3,$4,$5)`, [
      t.tokenHash, t.userId, t.kind, t.expiresAt, t.usedAt ?? null,
    ]);
  }

  async getValidAuthToken(tokenHash: string, kind: AuthToken["kind"]): Promise<AuthToken | null> {
    const rows = await this.q(`SELECT * FROM auth_tokens WHERE token_hash=$1 AND kind=$2`, [tokenHash, kind]);
    const r = rows[0];
    if (!r || r.used_at || (r.expires_at as string) < new Date().toISOString()) return null;
    return {
      tokenHash: r.token_hash as string,
      userId: r.user_id as string,
      kind: r.kind as AuthToken["kind"],
      expiresAt: r.expires_at as string,
      usedAt: (r.used_at as string | null) ?? null,
    };
  }

  async markAuthTokenUsed(tokenHash: string): Promise<void> {
    await this.q(`UPDATE auth_tokens SET used_at=$1 WHERE token_hash=$2`, [new Date().toISOString(), tokenHash]);
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.q(`UPDATE users SET password_hash=$1 WHERE id=$2`, [passwordHash, userId]);
  }

  async listUsers(institutionId: string): Promise<UserRecord[]> {
    const rows = await this.q(`SELECT * FROM users WHERE institution_id=$1 ORDER BY created_at`, [
      institutionId,
    ]);
    return rows.map(rowToUser);
  }

  async createOrgProfile(o: OrgProfile): Promise<void> {
    await this.q(
      `INSERT INTO org_profiles (institution_id,sector,course_id,join_code,owner_user_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [o.institutionId, o.sector, o.courseId, o.joinCode, o.ownerUserId, o.createdAt],
    );
  }

  async getOrgProfile(institutionId: string): Promise<OrgProfile | null> {
    const rows = await this.q(`SELECT * FROM org_profiles WHERE institution_id=$1`, [institutionId]);
    return rows[0] ? rowToOrg(rows[0]) : null;
  }

  async getOrgByJoinCode(joinCode: string): Promise<OrgProfile | null> {
    const rows = await this.q(`SELECT * FROM org_profiles WHERE join_code=$1`, [joinCode]);
    return rows[0] ? rowToOrg(rows[0]) : null;
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

  /**
   * Insert, or on conflict refresh only code and title. The other fields (join
   * code, archived, external id) are managed through `updateCourse`, so the
   * startup seed re-upserting a course can never reset them.
   */
  async upsertCourse(c: Course): Promise<void> {
    await this.q(
      `INSERT INTO courses (id,institution_id,code,title,join_code,external_id,archived,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, title=excluded.title`,
      [c.id, c.institutionId, c.code, c.title, c.joinCode ?? null, c.externalId ?? null, Boolean(c.archived), c.createdBy ?? null, c.createdAt ?? null],
    );
  }

  async getCourse(institutionId: string, courseId: string): Promise<Course | null> {
    const rows = await this.q(`SELECT * FROM courses WHERE id=$1 AND institution_id=$2`, [courseId, institutionId]);
    return rows[0] ? rowToCourse(rows[0]) : null;
  }

  async listCourses(institutionId: string): Promise<Course[]> {
    const rows = await this.q(`SELECT * FROM courses WHERE institution_id=$1 ORDER BY seq`, [institutionId]);
    return rows.map(rowToCourse);
  }

  async getCourseByJoinCode(joinCode: string): Promise<Course | null> {
    const rows = await this.q(`SELECT * FROM courses WHERE join_code=$1`, [joinCode]);
    return rows[0] ? rowToCourse(rows[0]) : null;
  }

  async updateCourse(institutionId: string, courseId: string, patch: CoursePatch): Promise<void> {
    const cur = await this.getCourse(institutionId, courseId);
    if (!cur) return;
    const n = { ...cur, ...patch };
    await this.q(
      `UPDATE courses SET code=$1, title=$2, external_id=$3, join_code=$4, archived=$5 WHERE id=$6 AND institution_id=$7`,
      [n.code, n.title, n.externalId ?? null, n.joinCode ?? null, Boolean(n.archived), courseId, institutionId],
    );
  }

  async addCourseMember(m: CourseMember): Promise<void> {
    await this.q(
      `INSERT INTO course_members (institution_id,course_id,user_id,enrolled_at) VALUES ($1,$2,$3,$4) ON CONFLICT (course_id,user_id) DO NOTHING`,
      [m.institutionId, m.courseId, m.userId, m.enrolledAt],
    );
  }

  async removeCourseMember(institutionId: string, courseId: string, userId: string): Promise<void> {
    await this.q(`DELETE FROM course_members WHERE institution_id=$1 AND course_id=$2 AND user_id=$3`, [institutionId, courseId, userId]);
  }

  async listCourseMembers(institutionId: string, courseId: string): Promise<CourseMember[]> {
    const rows = await this.q(
      `SELECT * FROM course_members WHERE institution_id=$1 AND course_id=$2 ORDER BY enrolled_at, user_id`,
      [institutionId, courseId],
    );
    return rows.map((r) => ({
      institutionId: r.institution_id as string,
      courseId: r.course_id as string,
      userId: r.user_id as string,
      enrolledAt: r.enrolled_at as string,
    }));
  }

  async listMemberCourseIds(institutionId: string, userId: string): Promise<string[]> {
    const rows = await this.q(`SELECT course_id FROM course_members WHERE institution_id=$1 AND user_id=$2`, [institutionId, userId]);
    return rows.map((r) => r.course_id as string);
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
    for (const table of ["assets", "chunks", "transcripts", "consent", "action_status", "lectures"]) {
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
    await this.ready;
    // Read-the-previous-hash and insert must be one atomic step per tenant, or
    // two concurrent appends could chain to the same predecessor and fork the
    // chain. The advisory lock serialises appends for one organisation only.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [e.institutionId]);
      const last = await client.query(
        `SELECT hash FROM audit WHERE institution_id=$1 AND hash IS NOT NULL ORDER BY seq DESC LIMIT 1`,
        [e.institutionId],
      );
      const prevHash = (last.rows[0]?.hash as string | undefined) ?? GENESIS;
      const hash = eventHash(prevHash, e, this.auditKey);
      await client.query(
        `INSERT INTO audit (institution_id,actor,action,target,ts,hash,prev_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [e.institutionId, e.actor, e.action, e.target, e.ts, hash, prevHash],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async listAudit(institutionId: string): Promise<AuditEvent[]> {
    const rows = await this.q(`SELECT * FROM audit WHERE institution_id=$1 ORDER BY seq`, [
      institutionId,
    ]);
    return rows.map((r) => ({
      institutionId: r.institution_id as string,
      actor: r.actor as string,
      action: r.action as string,
      target: r.target as string,
      ts: r.ts as string,
      hash: (r.hash as string | null) ?? null,
      prevHash: (r.prev_hash as string | null) ?? null,
    }));
  }

  async listActionStatuses(institutionId: string): Promise<ActionStatus[]> {
    const rows = await this.q(
      `SELECT * FROM action_status WHERE institution_id=$1 ORDER BY lecture_id, item_index`,
      [institutionId],
    );
    return rows.map((r) => ({
      institutionId: r.institution_id as string,
      lectureId: r.lecture_id as string,
      itemIndex: r.item_index as number,
      done: Boolean(r.done),
      assignee: (r.assignee as string | null) ?? null,
      updatedBy: r.updated_by as string,
      updatedAt: r.updated_at as string,
    }));
  }

  async upsertActionStatus(s: ActionStatus): Promise<void> {
    await this.q(
      `INSERT INTO action_status (institution_id,lecture_id,item_index,done,assignee,updated_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (institution_id,lecture_id,item_index) DO UPDATE SET
         done=EXCLUDED.done, assignee=EXCLUDED.assignee, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`,
      [s.institutionId, s.lectureId, s.itemIndex, s.done, s.assignee, s.updatedBy, s.updatedAt],
    );
  }

  async setLegalHold(institutionId: string, lectureId: string, hold: LegalHold | null): Promise<void> {
    await this.q(
      `UPDATE lectures SET hold_reason=$1, hold_by=$2, hold_at=$3 WHERE id=$4 AND institution_id=$5`,
      [hold?.reason ?? null, hold?.by ?? null, hold?.at ?? null, lectureId, institutionId],
    );
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

function rowToUser(r: Record<string, unknown>): UserRecord {
  return {
    id: r.id as string,
    email: r.email as string,
    name: r.name as string,
    passwordHash: r.password_hash as string,
    institutionId: r.institution_id as string,
    sector: r.sector as string,
    profile: r.profile as string,
    baseRole: r.base_role as UserRecord["baseRole"],
    createdAt: r.created_at as string,
    emailVerified: Boolean(r.email_verified),
  };
}

function rowToOrg(r: Record<string, unknown>): OrgProfile {
  return {
    institutionId: r.institution_id as string,
    sector: r.sector as string,
    courseId: r.course_id as string,
    joinCode: r.join_code as string,
    ownerUserId: r.owner_user_id as string,
    createdAt: r.created_at as string,
  };
}

function rowToCourse(r: Record<string, unknown>): Course {
  return {
    id: r.id as string,
    institutionId: r.institution_id as string,
    code: r.code as string,
    title: r.title as string,
    joinCode: (r.join_code as string | null) ?? null,
    externalId: (r.external_id as string | null) ?? null,
    archived: Boolean(r.archived),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  };
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
    ...(r.hold_at
      ? { hold: { reason: (r.hold_reason as string) ?? "", by: (r.hold_by as string) ?? "", at: r.hold_at as string } }
      : {}),
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
