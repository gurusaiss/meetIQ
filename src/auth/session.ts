/**
 * Session + identity layer.
 *
 * Identity is modeled as something an SSO provider ASSERTS about the user
 * (id, role, institution). The dev identity provider is a simple login form;
 * a SAML/LTI adapter (Phase 10) drops in behind the same `Session` shape
 * without the rest of the app changing — same ports-and-adapters discipline
 * used for storage and AI providers.
 *
 * Sessions are opaque random tokens stored server-side (here in-memory; a
 * shared store like Redis in prod), referenced by an httpOnly cookie, and
 * expire after a fixed TTL — an institutional session should not live
 * forever just because the server process does.
 */
import { randomBytes } from "node:crypto";

export type Role = "student" | "faculty" | "ta" | "admin";

export interface Identity {
  id: string;
  name: string;
  role: Role;
  institutionId: string;
}

export interface Session {
  token: string;
  identity: Identity;
  expiresAt: number;
}

export const COOKIE_NAME = "lip_sid";

/** 8 hours — a working session, not a permanent credential. */
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class SessionStore {
  private sessions = new Map<string, Session>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_SESSION_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  create(identity: Identity): Session {
    const token = randomBytes(24).toString("hex");
    const session: Session = { token, identity, expiresAt: Date.now() + this.ttlMs };
    this.sessions.set(token, session);
    return session;
  }

  /** Returns null for a missing OR expired token; expired entries are pruned. */
  get(token: string | undefined): Session | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  destroy(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }
}

/** Minimal cookie header parser (no dependency). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** RBAC check. */
export function hasRole(identity: Identity | null, allowed: Role[]): boolean {
  return identity !== null && allowed.includes(identity.role);
}

/**
 * Tiny in-memory sliding-window rate limiter, keyed by an arbitrary string
 * (e.g. client IP). Used to slow down login-endpoint abuse without any
 * external dependency (Redis is the prod target for multi-instance deploys).
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Records one attempt for `key` and returns true if it's within the limit. */
  check(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    existing.push(now);
    this.hits.set(key, existing);
    return existing.length <= this.max;
  }
}
