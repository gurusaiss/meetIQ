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
import { randomBytes, createHash } from "node:crypto";
import type { Repository, UserRecord } from "../persistence/repository.ts";
import type { Identity } from "./session.ts";
import { hashPassword, verifyPassword, burnVerify, passwordProblem } from "./password.ts";
import { getSector, getSectorRole, selectableRoles } from "./sectors.ts";
import type { EmailProvider } from "../integrations/email.ts";
import { MockEmailProvider } from "../integrations/email.ts";
import { logger } from "../observability/logger.ts";

/** How long a clicked link stays good for. Verification is low-stakes and people are slow to click; reset is higher-stakes and short-lived. */
const VERIFY_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export class AccountError extends Error {
  override name = "AccountError";
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

/** 12 readable chars, always has a letter and a digit so it passes the password rule. */
function tempPassword(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}-7a`.toLowerCase().replace(/^(.)/, (c) => c.toUpperCase());
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
  private readonly email: EmailProvider;
  /** Where the app is reachable, for links inside emails. No trailing slash. */
  private readonly baseUrl: string;

  constructor(repo: Repository, email: EmailProvider = new MockEmailProvider(), baseUrl = "http://localhost:3000") {
    this.repo = repo;
    this.email = email;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Create a token, store only its hash, and best-effort email the raw one in
   * a link. A real mail provider failing (bad key, provider outage) must not
   * break signup or a reset request — the person can always ask to resend —
   * so this logs and swallows rather than throwing.
   */
  private async issueAndSend(
    user: Pick<UserRecord, "id" | "email" | "name">,
    kind: "verify_email" | "reset_password",
    ttlMs: number,
    path: string,
    subject: string,
    body: (link: string) => string,
  ): Promise<void> {
    const raw = randomBytes(32).toString("hex");
    await this.repo.createAuthToken({
      tokenHash: hashToken(raw),
      userId: user.id,
      kind,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    });
    const link = `${this.baseUrl}${path}?token=${raw}`;
    try {
      await this.email.send({ to: user.email, subject, text: body(link) });
    } catch (e) {
      logger.error("email.send_failed", { kind, provider: this.email.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private sendVerificationEmail(user: Pick<UserRecord, "id" | "email" | "name">): Promise<void> {
    return this.issueAndSend(
      user,
      "verify_email",
      VERIFY_TOKEN_TTL_MS,
      "/verify-email",
      "Verify your email — MeetIQ",
      (link) => `Hi ${user.name},\n\nConfirm this is your email address:\n\n${link}\n\nThis link works for 48 hours. If you didn't create a MeetIQ account, ignore this message.`,
    );
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
          : sector.roles.some((r) => r.id === input.roleId)
            ? "Administrator roles can't be claimed with an invite code."
            : "Choose a valid role from the list for this field.",
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
    await this.sendVerificationEmail(user);
    return { id: userId, name, role: role.base, institutionId: institutionId!, sector: sector.id, profile: role.id, orgName, courseId: courseId!, owner };
  }

  /** Confirm an emailed link. Consuming a token is the proof — this needs no signed-in session. */
  async verifyEmail(rawToken: string): Promise<{ email: string; name: string }> {
    if (!rawToken) throw new AccountError(400, "That verification link is missing its token.");
    const tokenHash = hashToken(rawToken);
    const token = await this.repo.getValidAuthToken(tokenHash, "verify_email");
    if (!token) throw new AccountError(400, "That verification link has expired or was already used. Ask for a new one from your account page.");
    const user = await this.repo.getUserById(token.userId);
    if (!user) throw new AccountError(404, "That account no longer exists.");
    await this.repo.setEmailVerified(user.id, true);
    await this.repo.markAuthTokenUsed(tokenHash);
    await this.repo.audit({ institutionId: user.institutionId, actor: user.id, action: "email.verified", target: user.email, ts: new Date().toISOString() });
    return { email: user.email, name: user.name };
  }

  /** Re-send the verification link to the signed-in person's own address. A no-op (not an error) if already verified. */
  async resendVerification(identity: Identity): Promise<void> {
    const user = await this.repo.getUserById(identity.id);
    if (!user) throw new AccountError(404, "Account not found.");
    if (user.emailVerified) return;
    await this.sendVerificationEmail(user);
  }

  /**
   * Request a reset link. Always resolves the same way whether or not the
   * email matches an account (and whether or not that account has a
   * password), and always takes about the same time either way — the UI
   * message, and this method's behaviour, must never reveal which emails
   * have accounts.
   */
  async requestPasswordReset(emailRaw: string): Promise<void> {
    const email = normalizeEmail(emailRaw);
    const user = email ? await this.repo.getUserByEmail(email) : null;
    if (!user) {
      await burnVerify("x"); // spend roughly the time a real lookup+hash would, so timing doesn't leak the answer
      return;
    }
    await this.issueAndSend(
      user,
      "reset_password",
      RESET_TOKEN_TTL_MS,
      "/reset-password",
      "Reset your password — MeetIQ",
      (link) => `Hi ${user.name},\n\nSomeone asked to reset the password on this account. If that was you:\n\n${link}\n\nThis link works for 30 minutes and can be used once. If it wasn't you, ignore this message — your password hasn't changed.`,
    );
  }

  /** Complete a reset: set the new password and sign out every existing session (the service layer has no session store; the caller does that). */
  async resetPassword(rawToken: string, next: string): Promise<{ userId: string }> {
    if (!rawToken) throw new AccountError(400, "That reset link is missing its token.");
    const tokenHash = hashToken(rawToken);
    const token = await this.repo.getValidAuthToken(tokenHash, "reset_password");
    if (!token) throw new AccountError(400, "That reset link has expired or was already used. Request a new one.");
    const problem = passwordProblem(next);
    if (problem) throw new AccountError(400, problem);
    const user = await this.repo.getUserById(token.userId);
    if (!user) throw new AccountError(404, "That account no longer exists.");
    await this.repo.updatePasswordHash(user.id, await hashPassword(next));
    await this.repo.markAuthTokenUsed(tokenHash);
    await this.repo.audit({ institutionId: user.institutionId, actor: user.id, action: "password.reset_self", target: user.email, ts: new Date().toISOString() });
    return { userId: user.id };
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

  /** Change your own password. Needs the current one. */
  async changePassword(identity: Identity, current: string, next: string): Promise<void> {
    const user = (await this.repo.listUsers(identity.institutionId)).find((u) => u.id === identity.id);
    if (!user) throw new AccountError(404, "This account doesn't use a password (quick demo sign-in).");
    if (!(await verifyPassword(current, user.passwordHash))) throw new AccountError(401, "Your current password is wrong.");
    const problem = passwordProblem(next);
    if (problem) throw new AccountError(400, problem);
    await this.repo.updatePasswordHash(user.id, await hashPassword(next));
    await this.repo.audit({ institutionId: user.institutionId, actor: user.id, action: "password.changed", target: user.email, ts: new Date().toISOString() });
  }

  /**
   * An administrator sets a one-time temporary password for a member of the
   * same organisation (no email needed). Returned once; the member should
   * change it after signing in.
   */
  async resetMemberPassword(identity: Identity, email: string): Promise<{ id: string; name: string; email: string; temporary: string }> {
    if (identity.role !== "admin") throw new AccountError(403, "Only an administrator can reset a password.");
    const target = (await this.repo.listUsers(identity.institutionId)).find((u) => u.email === normalizeEmail(email));
    if (!target) throw new AccountError(404, "No such member in your organisation.");
    if (target.id === identity.id) throw new AccountError(400, "Use Change password for your own account.");
    const temporary = tempPassword();
    await this.repo.updatePasswordHash(target.id, await hashPassword(temporary));
    await this.repo.audit({ institutionId: identity.institutionId, actor: identity.id, action: "password.reset", target: target.email, ts: new Date().toISOString() });
    return { id: target.id, name: target.name, email: target.email, temporary };
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
