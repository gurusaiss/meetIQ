/**
 * SQLite adapter for the Repository port, on Node's built-in `node:sqlite`
 * (zero external dependencies). Suitable for local/dev and small pilots.
 * Embeddings are stored as JSON and searched in-app; the Postgres/pgvector
 * adapter (prod) pushes storage into a real `vector` column instead.
 *
 * Every method is `async` to satisfy the Repository port's signature, even
 * though node:sqlite itself is synchronous — there is no I/O wait to hide
 * here, just Promise-wrapping so callers don't need to know which adapter
 * they're talking to.
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
  ActionStatus,
  CourseMember,
  CoursePatch,
  AuthToken,
  LegalHold,
  UserRecord,
  OrgProfile,
} from "./repository.ts";
import { eventHash, GENESIS } from "../audit/chain.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY, name TEXT, consent_policy TEXT,
  data_region TEXT, retention_days INTEGER
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, institution_id TEXT, code TEXT, title TEXT,
  join_code TEXT, external_id TEXT, archived INTEGER, created_by TEXT, created_at TEXT
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
CREATE TABLE IF NOT EXISTS action_status (
  institution_id TEXT, lecture_id TEXT, item_index INTEGER, done INTEGER,
  assignee TEXT, updated_by TEXT, updated_at TEXT,
  PRIMARY KEY (institution_id, lecture_id, item_index)
);
CREATE TABLE IF NOT EXISTS audit (
  institution_id TEXT, actor TEXT, action TEXT, target TEXT, ts TEXT,
  hash TEXT, prev_hash TEXT
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
`;

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` never
 * alters a table that already exists, so a database created by an older
 * version would be missing these and every query touching them would fail.
 * Each is added only if absent, so this is safe to run on every start.
 */
const ADDED_COLUMNS: Array<[table: string, column: string, type: string]> = [
  ["lectures", "hold_reason", "TEXT"],
  ["lectures", "hold_by", "TEXT"],
  ["lectures", "hold_at", "TEXT"],
  ["audit", "hash", "TEXT"],
  ["audit", "prev_hash", "TEXT"],
  ["courses", "join_code", "TEXT"],
  ["courses", "external_id", "TEXT"],
  ["courses", "archived", "INTEGER"],
  ["courses", "created_by", "TEXT"],
  ["courses", "created_at", "TEXT"],
  ["users", "email_verified", "INTEGER"],
];

export interface SqliteRepositoryOptions {
  /** HMAC key for the audit chain (AUDIT_CHAIN_KEY). Empty = plain SHA-256. */
  auditKey?: string;
}

export class SqliteRepository implements Repository {
  private db: DatabaseSync;
  private readonly auditKey: string | undefined;

  /** `path` defaults to in-memory; pass a file path to persist to disk. */
  constructor(path = ":memory:", opts: SqliteRepositoryOptions = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    this.migrate();
    this.auditKey = opts.auditKey || undefined;
  }

  private migrate(): void {
    for (const [table, column, type] of ADDED_COLUMNS) {
      const have = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
      if (!have.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    // After the column exists (an older database lacks it until the loop above runs).
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_join_code ON courses(join_code)`);
  }

  async createUser(u: UserRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO users (id,email,name,password_hash,institution_id,sector,profile,base_role,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(u.id, u.email, u.name, u.passwordHash, u.institutionId, u.sector, u.profile, u.baseRole, u.createdAt);
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const r = this.db.prepare(`SELECT * FROM users WHERE email=?`).get(email) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToUser(r) : null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const r = this.db.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as Record<string, unknown> | undefined;
    return r ? rowToUser(r) : null;
  }

  async setEmailVerified(userId: string, verified: boolean): Promise<void> {
    this.db.prepare(`UPDATE users SET email_verified=? WHERE id=?`).run(verified ? 1 : 0, userId);
  }

  async createAuthToken(t: AuthToken): Promise<void> {
    this.db
      .prepare(`INSERT INTO auth_tokens (token_hash,user_id,kind,expires_at,used_at) VALUES (?,?,?,?,?)`)
      .run(t.tokenHash, t.userId, t.kind, t.expiresAt, t.usedAt ?? null);
  }

  async getValidAuthToken(tokenHash: string, kind: AuthToken["kind"]): Promise<AuthToken | null> {
    const r = this.db.prepare(`SELECT * FROM auth_tokens WHERE token_hash=? AND kind=?`).get(tokenHash, kind) as
      | Record<string, unknown>
      | undefined;
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
    this.db.prepare(`UPDATE auth_tokens SET used_at=? WHERE token_hash=?`).run(new Date().toISOString(), tokenHash);
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    this.db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(passwordHash, userId);
  }

  async listUsers(institutionId: string): Promise<UserRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM users WHERE institution_id=? ORDER BY created_at`)
      .all(institutionId) as Record<string, unknown>[];
    return rows.map(rowToUser);
  }

  async createOrgProfile(o: OrgProfile): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO org_profiles (institution_id,sector,course_id,join_code,owner_user_id,created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(o.institutionId, o.sector, o.courseId, o.joinCode, o.ownerUserId, o.createdAt);
  }

  async getOrgProfile(institutionId: string): Promise<OrgProfile | null> {
    const r = this.db.prepare(`SELECT * FROM org_profiles WHERE institution_id=?`).get(institutionId) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToOrg(r) : null;
  }

  async getOrgByJoinCode(joinCode: string): Promise<OrgProfile | null> {
    const r = this.db.prepare(`SELECT * FROM org_profiles WHERE join_code=?`).get(joinCode) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToOrg(r) : null;
  }

  async upsertInstitution(i: Institution): Promise<void> {
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

  async getInstitution(id: string): Promise<Institution | null> {
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

  /**
   * Insert, or on conflict refresh only code and title. The other fields (join
   * code, archived, external id) are managed through `updateCourse`, so the
   * startup seed re-upserting a course can never reset them.
   */
  async upsertCourse(c: Course): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO courses (id,institution_id,code,title,join_code,external_id,archived,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET code=excluded.code, title=excluded.title`,
      )
      .run(c.id, c.institutionId, c.code, c.title, c.joinCode ?? null, c.externalId ?? null, c.archived ? 1 : 0, c.createdBy ?? null, c.createdAt ?? null);
  }

  async getCourse(institutionId: string, courseId: string): Promise<Course | null> {
    const r = this.db.prepare(`SELECT * FROM courses WHERE id=? AND institution_id=?`).get(courseId, institutionId) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToCourse(r) : null;
  }

  async listCourses(institutionId: string): Promise<Course[]> {
    const rows = this.db.prepare(`SELECT * FROM courses WHERE institution_id=? ORDER BY rowid`).all(institutionId) as Record<string, unknown>[];
    return rows.map(rowToCourse);
  }

  async getCourseByJoinCode(joinCode: string): Promise<Course | null> {
    const r = this.db.prepare(`SELECT * FROM courses WHERE join_code=?`).get(joinCode) as Record<string, unknown> | undefined;
    return r ? rowToCourse(r) : null;
  }

  async updateCourse(institutionId: string, courseId: string, patch: CoursePatch): Promise<void> {
    const cur = await this.getCourse(institutionId, courseId);
    if (!cur) return;
    const n = { ...cur, ...patch };
    this.db
      .prepare(`UPDATE courses SET code=?, title=?, external_id=?, join_code=?, archived=? WHERE id=? AND institution_id=?`)
      .run(n.code, n.title, n.externalId ?? null, n.joinCode ?? null, n.archived ? 1 : 0, courseId, institutionId);
  }

  async addCourseMember(m: CourseMember): Promise<void> {
    this.db
      .prepare(`INSERT INTO course_members (institution_id,course_id,user_id,enrolled_at) VALUES (?,?,?,?) ON CONFLICT(course_id,user_id) DO NOTHING`)
      .run(m.institutionId, m.courseId, m.userId, m.enrolledAt);
  }

  async removeCourseMember(institutionId: string, courseId: string, userId: string): Promise<void> {
    this.db.prepare(`DELETE FROM course_members WHERE institution_id=? AND course_id=? AND user_id=?`).run(institutionId, courseId, userId);
  }

  async listCourseMembers(institutionId: string, courseId: string): Promise<CourseMember[]> {
    const rows = this.db
      .prepare(`SELECT * FROM course_members WHERE institution_id=? AND course_id=? ORDER BY enrolled_at, user_id`)
      .all(institutionId, courseId) as Record<string, unknown>[];
    return rows.map((r) => ({
      institutionId: r.institution_id as string,
      courseId: r.course_id as string,
      userId: r.user_id as string,
      enrolledAt: r.enrolled_at as string,
    }));
  }

  async listMemberCourseIds(institutionId: string, userId: string): Promise<string[]> {
    const rows = this.db
      .prepare(`SELECT course_id FROM course_members WHERE institution_id=? AND user_id=?`)
      .all(institutionId, userId) as Array<{ course_id: string }>;
    return rows.map((r) => r.course_id);
  }

  async createLecture(l: Lecture): Promise<void> {
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

  async setLectureStatus(institutionId: string, lectureId: string, status: LectureStatus): Promise<void> {
    this.db
      .prepare(`UPDATE lectures SET status=? WHERE id=? AND institution_id=?`)
      .run(status, lectureId, institutionId);
  }

  async listLecturesByCourse(institutionId: string, courseId: string): Promise<Lecture[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM lectures WHERE course_id=? AND institution_id=? ORDER BY created_at`,
      )
      .all(courseId, institutionId) as Record<string, unknown>[];
    return rows.map(rowToLecture);
  }

  async listLectures(institutionId: string): Promise<Lecture[]> {
    const rows = this.db
      .prepare(`SELECT * FROM lectures WHERE institution_id=? ORDER BY created_at`)
      .all(institutionId) as Record<string, unknown>[];
    return rows.map(rowToLecture);
  }

  async deleteLecture(institutionId: string, lectureId: string): Promise<void> {
    for (const table of ["assets", "chunks", "transcripts", "consent", "action_status", "lectures"]) {
      const col = table === "lectures" ? "id" : "lecture_id";
      this.db
        .prepare(`DELETE FROM ${table} WHERE ${col}=? AND institution_id=?`)
        .run(lectureId, institutionId);
    }
  }

  async getLecture(institutionId: string, lectureId: string): Promise<Lecture | null> {
    const r = this.db
      .prepare(`SELECT * FROM lectures WHERE id=? AND institution_id=?`)
      .get(lectureId, institutionId) as Record<string, unknown> | undefined;
    return r ? rowToLecture(r) : null;
  }

  async listActionStatuses(institutionId: string): Promise<ActionStatus[]> {
    const rows = this.db
      .prepare(`SELECT * FROM action_status WHERE institution_id=? ORDER BY lecture_id, item_index`)
      .all(institutionId) as Record<string, unknown>[];
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
    this.db
      .prepare(
        `INSERT INTO action_status (institution_id,lecture_id,item_index,done,assignee,updated_by,updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(institution_id,lecture_id,item_index) DO UPDATE SET
           done=excluded.done, assignee=excluded.assignee, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      )
      .run(s.institutionId, s.lectureId, s.itemIndex, s.done ? 1 : 0, s.assignee, s.updatedBy, s.updatedAt);
  }

  async setLegalHold(institutionId: string, lectureId: string, hold: LegalHold | null): Promise<void> {
    this.db
      .prepare(`UPDATE lectures SET hold_reason=?, hold_by=?, hold_at=? WHERE id=? AND institution_id=?`)
      .run(hold?.reason ?? null, hold?.by ?? null, hold?.at ?? null, lectureId, institutionId);
  }

  async saveConsent(c: ConsentRecord): Promise<void> {
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

  async getConsent(institutionId: string, lectureId: string): Promise<ConsentRecord | null> {
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

  async saveTranscript(institutionId: string, t: Transcript): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO transcripts (lecture_id,institution_id,language,provider,segments)
         VALUES (?,?,?,?,?)
         ON CONFLICT(lecture_id) DO UPDATE SET language=excluded.language,
           provider=excluded.provider, segments=excluded.segments`,
      )
      .run(t.lectureId, institutionId, t.language, t.provider, JSON.stringify(t.segments));
  }

  async getTranscript(institutionId: string, lectureId: string): Promise<Transcript | null> {
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

  async saveAssets(
    institutionId: string,
    lectureId: string,
    assets: KnowledgeAsset[],
  ): Promise<StoredAsset[]> {
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

  async getAsset(institutionId: string, assetId: string): Promise<StoredAsset | null> {
    const r = this.db
      .prepare(`SELECT * FROM assets WHERE id=? AND institution_id=?`)
      .get(assetId, institutionId) as Record<string, unknown> | undefined;
    return r ? rowToAsset(r) : null;
  }

  async listAssets(institutionId: string, lectureId: string): Promise<StoredAsset[]> {
    const rows = this.db
      .prepare(`SELECT * FROM assets WHERE lecture_id=? AND institution_id=?`)
      .all(lectureId, institutionId) as Record<string, unknown>[];
    return rows.map(rowToAsset);
  }

  async setAssetStatus(institutionId: string, assetId: string, status: AssetStatus): Promise<void> {
    this.db
      .prepare(`UPDATE assets SET status=? WHERE id=? AND institution_id=?`)
      .run(status, assetId, institutionId);
  }

  async saveChunks(institutionId: string, courseId: string, chunks: Chunk[]): Promise<void> {
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

  async listCourseChunks(institutionId: string, courseId: string): Promise<Chunk[]> {
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

  async audit(e: AuditEvent): Promise<void> {
    // Read-the-previous-hash and insert must be one atomic step, or two
    // appends could both chain to the same predecessor and fork the chain.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const last = this.db
        .prepare(`SELECT hash FROM audit WHERE institution_id=? AND hash IS NOT NULL ORDER BY rowid DESC LIMIT 1`)
        .get(e.institutionId) as { hash: string } | undefined;
      const prevHash = last?.hash ?? GENESIS;
      const hash = eventHash(prevHash, e, this.auditKey);
      this.db
        .prepare(`INSERT INTO audit (institution_id,actor,action,target,ts,hash,prev_hash) VALUES (?,?,?,?,?,?,?)`)
        .run(e.institutionId, e.actor, e.action, e.target, e.ts, hash, prevHash);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async listAudit(institutionId: string): Promise<AuditEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM audit WHERE institution_id=? ORDER BY rowid`)
      .all(institutionId) as Record<string, unknown>[];
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

  async healthcheck(): Promise<boolean> {
    try {
      const r = this.db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
      return r?.ok === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
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
