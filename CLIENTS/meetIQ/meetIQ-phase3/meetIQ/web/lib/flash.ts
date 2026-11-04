import { randomBytes } from "node:crypto";

/**
 * One-time, in-memory hand-off of a secret (a temporary password) from a POST
 * handler to the page that shows it, so it never travels in a URL or log.
 * Read once, expires after two minutes.
 */
interface Entry { value: unknown; owner: string; expires: number }
const g = globalThis as unknown as { __lipFlash?: Map<string, Entry> };
const store = (g.__lipFlash ??= new Map());

export function putFlash(owner: string, value: unknown): string {
  const now = Date.now();
  for (const [k, e] of store) if (e.expires < now) store.delete(k);
  const token = randomBytes(16).toString("hex");
  store.set(token, { value, owner, expires: now + 120_000 });
  return token;
}

export function takeFlash<T>(token: string, owner: string): T | null {
  const e = store.get(token);
  store.delete(token);
  if (!e || e.expires < Date.now() || e.owner !== owner) return null;
  return e.value as T;
}
