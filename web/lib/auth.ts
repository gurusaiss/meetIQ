import { cache } from "react";
import { cookies } from "next/headers";
import { getSessions, getService } from "./singletons.ts";
import { COOKIE_NAME, type Identity, type Role } from "../../src/auth/session.ts";

export type { Identity, Role };

/** Which course the person has switched to. Only a preference: it is re-checked against their access on every request. */
export const COURSE_COOKIE = "lip_course";

/**
 * Reads the current identity from the session cookie (Server Components + Route Handlers).
 *
 * The identity's `courseId` is the course they are "in". It starts as the one
 * their account was created with, and can be switched with the course cookie.
 * The cookie is trusted for nothing: it only takes effect if the service says
 * this person can reach that course right now (so a forged value, a course
 * since archived, or someone removed from the course all fall back to the
 * default). Every page that scopes by `identity.courseId` therefore gets that
 * check without repeating it.
 */
export const getIdentity = cache(async (): Promise<Identity | null> => {
  const jar = await cookies();
  const base = getSessions().get(jar.get(COOKIE_NAME)?.value)?.identity ?? null;
  if (!base) return null;
  const picked = jar.get(COURSE_COOKIE)?.value;
  if (picked && base.courseId && picked !== base.courseId) {
    if (await getService().canAccessCourse(base.institutionId, picked, base)) return { ...base, courseId: picked };
  }
  return base;
});

export function hasRole(identity: Identity | null, allowed: Role[]): boolean {
  return identity !== null && allowed.includes(identity.role);
}

export { COOKIE_NAME };
