/**
 * Accounts and organisations. Sits on the Repository port, so it works the
 * same on SQLite and Postgres, and depends on nothing web-specific.
 *
 * Model: an organisation is a tenant (`institutionId`). Creating one makes the
 * creator its admin-level owner and mints an invite code. Joining needs that
 * code, and never grants admin powers. A person can't read another
 * organisation's data by choosing a role, because the role only means
 * something inside the tenant they belong to.
 */
import { randomBytes } from "node:crypto";
import type { Repository, UserRecord } from "../persistence/repository.ts";
import type { Identity } from "./session.ts";
import { hashPassword, verifyPassword, burnVerify, passwordProblem } from "./password.ts";
import { getSector, getSectorRole, selectableRoles } from "./sectors.ts";

export class AccountError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SignUpInput {
  mode: "create" | "join";
  sector: string;
  roleId: string;
  name: string;
  email: string;
  password: string;
  orgName?: string;
  joinCode?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// No 0/O/1/I so a code read aloud or off a screen can't be mistyped.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Uppercase, strip separators: accepts "abcd-efgh", "ABCD EFGH", etc. */
export function normalizeJoinCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatJoinCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

function newJoinCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "org";
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

export class AccountService {
  private readonly repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  async signUp(input: SignUpInput): Promise<Identity> {
    const sector = getSector(input.sector);
    if (!sector) throw new AccountError(400, "Choose a field first.");
    if (input.mode !== "create" && input.mode !== "join") throw new AccountError(400, "Choose to create or join an organisation.");

    const name = input.name.trim();
    if (!name || name.length > 100) throw new AccountError(400, "Enter your name (under 100 characters).");
    const email = normalizeEmail(input.email);
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new AccountError(400, "Enter a valid email address.");
    const pwProblem = passwordProblem(input.password);
    if (pwProblem) throw new AccountError(400, pwProblem);

    const role = selectableRoles(sector, input.mode).find((r) => r.id === input.roleId);
    if (!role) {
      throw new AccountError(
        400,
        input.mode === "create"
          ? "Creating an organisation makes you its administrator. Choose one of the administrator roles."
          : "Choose a role. Administrator roles can't be claimed with an invite code.",
      );
    }

    let institutionId: string;
    let courseId: string;
    let orgName: string;
    let owner = false;
    const userId = newId("u");

    if (input.mode === "create") {
      orgName = (input.orgName ?? "").trim();
      if (orgName.length < 2 || orgName.length > 80) throw new AccountError(400, `Enter your ${sector.orgLabel.toLowerCase()} (2-80 characters).`);
    } else {
      const code = normalizeJoinCode(input.joinCode ?? "");
      const org = code ? await this.repo.getOrgByJoinCode(code) : null;
      if (!org || org.sector !== sector.id) {
        // Same message for "no such code" and "wrong field": no probing for valid codes.
        throw new AccountError(404, "That invite code didn't match an organisation in this field. Check it with your administrator.");
      }
      institutionId = org.institutionId;
      courseId = org.courseId;
      orgName = (await this.repo.getInstitution(org.institutionId))?.name ?? "Organisation";
    }

    if (await this.repo.getUserByEmail(email)) {
      throw new AccountError(409, "An account with this email already exists. Sign in instead.");
    }
    const passwordHash = await hashPassword(input.password);
    const now = new Date().toISOString();

    if (input.mode === "create") {
      institutionId = `org-${slug(orgName)}-${randomBytes(3).toString("hex")}`;
      courseId = `c-${institutionId}`;
      owner = true;
      await this.repo.upsertInstitution({
        id: institutionId,
        name: orgName,
        consentPolicy: "all_party",
        dataRegion: "us-east",
        retentionDays: 365,
      });
      await this.repo.upsertCourse({ id: courseId, institutionId, code: "MAIN", title: `${orgName} · Workspace` });
      await this.repo.createOrgProfile({
        institutionId,
        sector: sector.id,
        courseId,
        joinCode: newJoinCode(),
        ownerUserId: userId,
        createdAt: now,
      });
    }

    const user: UserRecord = {
      id: userId,
      email,
      name,
      passwordHash,
      institutionId: institutionId!,
      sector: sector.id,
      profile: role.id,
      baseRole: role.base,
      createdAt: now,
    };
    try {
      await this.repo.createUser(user);
    } catch {
      // Lost a race on the unique email index between the check and the insert.
      throw new AccountError(409, "An account with this email already exists. Sign in instead.");
    }
    await this.repo.audit({
      institutionId: institutionId!,
      actor: userId,
      action: input.mode === "create" ? "org.created" : "user.joined",
      target: `${role.name} · ${email}`,
      ts: now,
    });
    return { id: userId, name, role: role.base, institutionId: institutionId!, sector: sector.id, profile: role.id, orgName, courseId: courseId!, owner };
  }

  /** Returns the identity, or throws a 401 that doesn't say whether the email exists. */
  async signIn(emailRaw: string, password: string): Promise<Identity> {
    const email = normalizeEmail(emailRaw);
    const user = email && password ? await this.repo.getUserByEmail(email) : null;
    if (!user) {
      await burnVerify(password || "x");
      throw new AccountError(401, "Wrong email or password.");
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw new AccountError(401, "Wrong email or password.");
    return this.identityFor(user);
  }

  async identityFor(user: UserRecord): Promise<Identity> {
    const [org, inst] = await Promise.all([
      this.repo.getOrgProfile(user.institutionId),
      this.repo.getInstitution(user.institutionId),
    ]);
    return {
      id: user.id,
      name: user.name,
      role: user.baseRole,
      institutionId: user.institutionId,
      sector: user.sector,
      profile: user.profile,
      orgName: inst?.name ?? "Organisation",
      courseId: org?.courseId ?? `c-${user.institutionId}`,
      owner: org?.ownerUserId === user.id,
    };
  }

  /** The invite code, only for the organisation's owner. */
  async inviteCodeFor(identity: Identity): Promise<string | null> {
    if (!identity.owner) return null;
    return (await this.repo.getOrgProfile(identity.institutionId))?.joinCode ?? null;
  }

  async members(identity: Identity): Promise<Array<{ name: string; email: string; title: string; role: string; since: string }>> {
    const users = await this.repo.listUsers(identity.institutionId);
    return users.map((u) => ({
      name: u.name,
      email: u.email,
      title: getSectorRole(u.sector, u.profile)?.name ?? u.profile,
      role: u.baseRole,
      since: u.createdAt,
    }));
  }
}
