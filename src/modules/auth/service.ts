/**
 * Authentication service.
 *
 * Phone + OTP is the primary factor: in the target market phone is the real
 * identity and email is a weak identifier. Email + password exists as an
 * alternative and is what platform admins use.
 *
 * All identity access runs on the system pool - the tenant-restricted role has
 * no grants at all on users, sessions, otp_codes or platform_admins.
 */
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { withSystem } from '../tenancy';
import { schema } from '../db/client';
import { env } from '../core/env';
import {
  constantTimeEquals,
  generateOtp,
  generateSessionToken,
  hashIp,
  hashPassword,
  hashToken,
  verifyPassword,
} from './crypto';
import { LIMITS, RateLimitError, enforce, maybeSweep } from './rate-limit';
import { DURABLE_LIMITS, enforceDurable } from './durable-rate-limit';
import type { MerchantRole, Principal, PlatformRole } from './rbac';
import { sendSms } from '../notify/sms';
import { recordAuditSafe } from '../core/audit';

const SESSION_TTL_DAYS = 90;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

export class AuthError extends Error {
  override readonly name = 'AuthError';
  readonly status = 401;
}

/** E.164-ish normalisation, defaulting to India. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  const local = digits.replace(/^\+/, '');
  if (/^[6-9]\d{9}$/.test(local)) return `+91${local}`;
  if (/^91[6-9]\d{9}$/.test(local)) return `+${local}`;
  if (/^0[6-9]\d{9}$/.test(local)) return `+91${local.slice(1)}`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* OTP                                                                        */
/* -------------------------------------------------------------------------- */

export async function requestOtp(rawPhone: string, ip: string): Promise<{ sent: true }> {
  maybeSweep();
  const phone = normalisePhone(rawPhone);
  if (!phone) throw new AuthError('Enter a valid mobile number.');

  enforce(`otp:ip:${ip}`, LIMITS.otpRequestPerIp);
  await enforceDurable(`otp:phone:${phone}`, DURABLE_LIMITS.otpRequestPerPhone);

  // Durable check as well: OTP sends cost real money, so the limit must
  // survive a process restart.
  await withSystem(async ({ tx }) => {
    const since = new Date(Date.now() - LIMITS.otpRequestPerPhone.windowSeconds * 1000);
    const recent = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.phone, phone), gt(schema.otpCodes.createdAt, since)));
    if ((recent[0]?.n ?? 0) >= LIMITS.otpRequestPerPhone.limit) {
      throw new RateLimitError(60, 'Too many codes requested. Please wait a few minutes.');
    }

    const code = generateOtp();
    await tx.insert(schema.otpCodes).values({
      phone,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
    });
    await sendSms(phone, `${code} is your verification code. It expires in ${OTP_TTL_MINUTES} minutes.`);
  });

  return { sent: true };
}

export async function verifyOtp(
  rawPhone: string,
  code: string,
  context: { ip: string; userAgent: string },
): Promise<{ token: string; userId: string }> {
  const phone = normalisePhone(rawPhone);
  if (!phone) throw new AuthError('Enter a valid mobile number.');
  await enforceDurable(`otpv:${phone}`, DURABLE_LIMITS.otpVerifyPerPhone);

  return withSystem(async ({ tx }) => {
    const [record] = await tx
      .select()
      .from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.phone, phone), isNull(schema.otpCodes.consumedAt)))
      .orderBy(desc(schema.otpCodes.createdAt))
      .limit(1);

    if (!record) throw new AuthError('That code is not valid. Request a new one.');
    if (record.expiresAt <= new Date()) throw new AuthError('That code has expired. Request a new one.');
    if (record.attempts >= OTP_MAX_ATTEMPTS) throw new AuthError('Too many attempts. Request a new code.');

    if (!constantTimeEquals(hashToken(code), record.codeHash)) {
      await tx
        .update(schema.otpCodes)
        .set({ attempts: record.attempts + 1 })
        .where(eq(schema.otpCodes.id, record.id));
      throw new AuthError('That code is not correct.');
    }

    await tx
      .update(schema.otpCodes)
      .set({ consumedAt: new Date() })
      .where(eq(schema.otpCodes.id, record.id));

    let [user] = await tx.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
    if (!user) {
      [user] = await tx.insert(schema.users).values({ phone }).returning();
    }
    if (!user) throw new AuthError('Could not sign you in.');
    if (user.status !== 'active') throw new AuthError('This account is disabled.');

    const token = await createSession(tx, user.id, context);
    await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    return { token, userId: user.id };
  });
}

/* -------------------------------------------------------------------------- */
/* Password login (platform admins and merchants who prefer it)                */
/* -------------------------------------------------------------------------- */

export type PasswordLoginResult =
  | { step: 'done'; token: string; userId: string }
  | { step: 'pin_setup'; userId: string }
  | { step: 'pin_required'; userId: string };

/**
 * Password step only. Platform admins carry a mandatory static 6-digit PIN
 * as a second factor, so a platform admin never gets a session from this
 * call alone — it either asks for the existing PIN (`pin_required`) or, on
 * the very first login, asks them to choose one (`pin_setup`). Merchants who
 * use password login (rather than phone-OTP) are not required to have a
 * second factor and get a session immediately.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  context: { ip: string; userAgent: string },
): Promise<PasswordLoginResult> {
  await enforceDurable(`login:ip:${context.ip}`, DURABLE_LIMITS.loginPerIp);

  return withSystem(async ({ tx }) => {
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.trim().toLowerCase()))
      .limit(1);

    // Always run a verification so a missing account and a wrong password take
    // the same time and produce the same message - no account enumeration.
    const stored = user?.passwordHash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const ok = await verifyPassword(password, stored);

    if (!user || !user.passwordHash || !ok) throw new AuthError('Email or password is incorrect.');
    if (user.status !== 'active') throw new AuthError('This account is disabled.');

    const [admin] = await tx
      .select()
      .from(schema.platformAdmins)
      .where(eq(schema.platformAdmins.userId, user.id))
      .limit(1);

    if (admin) {
      return { step: user.adminPinHash ? 'pin_required' : 'pin_setup', userId: user.id };
    }

    const token = await createSession(tx, user.id, context);
    await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    return { step: 'done', token, userId: user.id };
  });
}

/**
 * Second step for platform admins: either choose a PIN for the first time
 * (`isSetup`) or verify the existing one, then create a session. A static
 * PIN rather than TOTP, by deliberate choice (docs/09) — weaker than a true
 * second factor since it's "something you know" twice rather than "know +
 * have", but is usable without an authenticator app.
 */
export async function completePinLogin(
  userId: string,
  pin: string,
  context: { ip: string; userAgent: string },
  isSetup: boolean,
): Promise<{ token: string; userId: string }> {
  await enforceDurable(`pin:${userId}`, DURABLE_LIMITS.pinPerUser);

  if (!/^\d{6}$/.test(pin)) throw new AuthError('PIN must be exactly 6 digits.');

  return withSystem(async ({ tx }) => {
    const [admin] = await tx
      .select()
      .from(schema.platformAdmins)
      .where(eq(schema.platformAdmins.userId, userId))
      .limit(1);
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);

    if (!admin || !user) throw new AuthError('That code is not correct.');

    if (isSetup) {
      // Re-check here, not just in the UI: a stale "setup" form resubmitted
      // after a PIN already exists must not silently overwrite it.
      if (user.adminPinHash) throw new AuthError('A PIN is already set for this account.');
      const adminPinHash = await hashPassword(pin);
      await tx.update(schema.users).set({ adminPinHash }).where(eq(schema.users.id, userId));
    } else {
      const ok = user.adminPinHash && (await verifyPassword(pin, user.adminPinHash));
      if (!ok) {
        await recordAuditSafe({
          action: 'security.pin_rejected',
          actorUserId: userId,
          actorType: 'platform',
          entityType: 'pin_attempt',
        });
        throw new AuthError('That PIN is not correct.');
      }
    }

    const token = await createSession(tx, userId, context);
    await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
    return { token, userId };
  });
}

/**
 * Phone + PIN: a merchant's single-factor login that needs no SMS at all -
 * the PIN is set once by the admin at creation (or changed by the merchant
 * afterward), never sent anywhere. This exists specifically because
 * phone+OTP is hidden until an SMS driver is configured (login-form.tsx);
 * without this, a merchant who prefers phone over email had no way to sign
 * in at all.
 */
export async function loginWithPhonePin(
  rawPhone: string,
  pin: string,
  context: { ip: string; userAgent: string },
): Promise<{ token: string; userId: string }> {
  const phone = normalisePhone(rawPhone);
  if (!phone) throw new AuthError('Enter a valid mobile number.');
  if (!/^\d{6}$/.test(pin)) throw new AuthError('PIN must be exactly 6 digits.');

  await enforceDurable(`pinlogin:${phone}`, DURABLE_LIMITS.pinLoginPerPhone);

  return withSystem(async ({ tx }) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);

    // Same constant-time-regardless-of-existence shape as loginWithPassword:
    // a missing account and a wrong PIN must look identical to the caller.
    const stored = user?.pinHash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const ok = await verifyPassword(pin, stored);

    if (!user || !user.pinHash || !ok) throw new AuthError('Mobile number or PIN is incorrect.');
    if (user.status !== 'active') throw new AuthError('This account is disabled.');

    const token = await createSession(tx, user.id, context);
    await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    return { token, userId: user.id };
  });
}

/** Lets a merchant change their own phone-login PIN (distinct from a platform admin's). */
export async function setMerchantPin(userId: string, pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new AuthError('PIN must be exactly 6 digits.');
  const pinHash = await hashPassword(pin);
  await withSystem(({ tx }) => tx.update(schema.users).set({ pinHash }).where(eq(schema.users.id, userId)));
}

export async function setPassword(userId: string, password: string): Promise<void> {
  if (password.length < 10) throw new AuthError('Use at least 10 characters.');
  const passwordHash = await hashPassword(password);
  await withSystem(({ tx }) =>
    tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId)),
  );
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

type AnyTx = Parameters<Parameters<typeof withSystem>[0]>[0]['tx'];

async function createSession(
  tx: AnyTx,
  userId: string,
  context: { ip: string; userAgent: string; impersonatedBy?: string },
): Promise<string> {
  const token = generateSessionToken();
  const [membership] = await tx
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId))
    .limit(1);

  await tx.insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    activeTenantId: membership?.tenantId ?? null,
    ipHash: hashIp(env().SESSION_SECRET, context.ip),
    userAgent: context.userAgent.slice(0, 300),
    impersonatedBy: context.impersonatedBy ?? null,
    expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000),
  });
  return token;
}

export type ResolvedSession = {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  impersonatedBy: string | null;
  merchantRole: MerchantRole | null;
  platformRole: PlatformRole | null;
};

/** Resolves an opaque token to a principal. Returns null for anything invalid. */
export async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
  if (!token) return null;
  return withSystem(async ({ tx }) => {
    const [row] = await tx
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashToken(token)))
      .limit(1);

    if (!row || row.revokedAt || row.expiresAt <= new Date()) return null;

    const [admin] = await tx
      .select()
      .from(schema.platformAdmins)
      .where(eq(schema.platformAdmins.userId, row.userId))
      .limit(1);

    let merchantRole: MerchantRole | null = null;
    if (row.activeTenantId) {
      const [membership] = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, row.userId),
            eq(schema.memberships.tenantId, row.activeTenantId),
          ),
        )
        .limit(1);
      merchantRole = membership?.role ?? null;
    }

    return {
      sessionId: row.id,
      userId: row.userId,
      activeTenantId: row.activeTenantId,
      impersonatedBy: row.impersonatedBy,
      merchantRole,
      platformRole: admin?.role ?? null,
    };
  });
}

/**
 * Builds the principal used by every authorization check.
 * The tenant comes from the session, never from the request.
 */
export function principalFromSession(session: ResolvedSession | null): Principal {
  if (!session) return { kind: 'anon' };
  if (session.platformRole && !session.impersonatedBy) {
    return { kind: 'platform', userId: session.userId, role: session.platformRole };
  }
  if (session.activeTenantId && session.merchantRole) {
    return {
      kind: 'merchant',
      userId: session.userId,
      tenantId: session.activeTenantId,
      role: session.merchantRole,
    };
  }
  return { kind: 'anon' };
}

/**
 * Lets a platform admin view and act inside a merchant's dashboard, scoped to
 * that tenant's own owner account. This is the ONLY way into a merchant
 * dashboard right now for anyone other than the merchant themselves, since
 * merchants have no password and phone+OTP login is hidden until an SMS
 * driver is configured (see login-form.tsx) - without it, nobody could ever
 * demo or support a merchant's account.
 */
export async function startImpersonation(args: {
  tenantId: string;
  actorAdminUserId: string;
  context: { ip: string; userAgent: string };
}): Promise<{ token: string }> {
  return withSystem(async ({ tx }) => {
    const [membership] = await tx
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, args.tenantId), eq(schema.memberships.role, 'owner')))
      .orderBy(schema.memberships.createdAt)
      .limit(1);
    if (!membership) {
      throw new AuthError('This merchant has no owner account yet to sign in as.');
    }

    const token = await createSession(tx, membership.userId, {
      ...args.context,
      impersonatedBy: args.actorAdminUserId,
    });

    await recordAuditSafe({
      action: 'admin.impersonate.start',
      actorUserId: args.actorAdminUserId,
      actorType: 'platform',
      tenantId: args.tenantId,
      entityType: 'tenant',
      entityId: args.tenantId,
    });

    return { token };
  });
}

export async function revokeSession(token: string): Promise<void> {
  await withSystem(({ tx }) =>
    tx
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.tokenHash, hashToken(token))),
  );
}

export async function switchActiveTenant(sessionId: string, tenantId: string): Promise<void> {
  await withSystem(async ({ tx }) => {
    const [session] = await tx
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) throw new AuthError('Session not found.');

    // Verified server-side: a user may only switch to a tenant they belong to.
    const [membership] = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, session.userId),
          eq(schema.memberships.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!membership) throw new AuthError('You do not have access to that business.');

    await tx
      .update(schema.sessions)
      .set({ activeTenantId: tenantId })
      .where(eq(schema.sessions.id, sessionId));
  });
}

export const SESSION_COOKIE = 'mdp_session';
export const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 86_400;
