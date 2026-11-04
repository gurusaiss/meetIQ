import { cookies } from "next/headers";
import { getSessions } from "./singletons.ts";
import { COOKIE_NAME, type Identity, type Role } from "../../src/auth/session.ts";

export type { Identity, Role };

/** Reads the current identity from the session cookie (Server Components + Route Handlers). */
export async function getIdentity(): Promise<Identity | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  return getSessions().get(token)?.identity ?? null;
}

export function hasRole(identity: Identity | null, allowed: Role[]): boolean {
  return identity !== null && allowed.includes(identity.role);
}

export { COOKIE_NAME };
