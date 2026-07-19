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
 * shared store like Redis in prod), referenced by an httpOnly cookie.
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
}

export const COOKIE_NAME = "lip_sid";

export class SessionStore {
  private sessions = new Map<string, Session>();

  create(identity: Identity): Session {
    const token = randomBytes(24).toString("hex");
    const session: Session = { token, identity };
    this.sessions.set(token, session);
    return session;
  }

  get(token: string | undefined): Session | null {
    if (!token) return null;
    return this.sessions.get(token) ?? null;
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
