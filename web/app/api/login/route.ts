import type { NextRequest } from "next/server";
import { DEMO_INSTITUTION_ID, DEMO_COURSE_ID, DEMO_ORG_NAME } from "../../../lib/singletons.ts";
import type { Identity, Role } from "../../../lib/auth.ts";
import { tooManyAttempts, startSession, redirectTo, field } from "../../../lib/session.ts";
import { config } from "../../../../src/config.ts";

/**
 * "Quick demo" sign-in: pick a role, no password, into a shared sample
 * organisation (State University). Real accounts use /api/signin and
 * /api/signup. Turn this off with DEMO_LOGIN=0 for a deployment holding real data.
 */
const DEMO_ROLES: Role[] = ["student", "faculty", "ta", "admin", "auditor"];
// Display title inside the sample university, per permission role.
const DEMO_PROFILE: Record<Role, string> = {
  faculty: "faculty",
  ta: "faculty",
  student: "student",
  admin: "admin",
  auditor: "faculty",
};

export async function POST(req: NextRequest) {
  if (!config.security.demoLogin) {
    return redirectTo(req, "/login", { error: "Quick demo sign-in is turned off. Please sign in with your account." });
  }
  if (tooManyAttempts(req)) {
    return redirectTo(req, "/login", { error: "Too many attempts. Please wait a minute and try again." });
  }

  const form = await req.formData();
  const name = field(form, "name", 101);
  const role = field(form, "role", 20) as Role;
  if (!name || name.length > 100 || !DEMO_ROLES.includes(role)) {
    return redirectTo(req, "/login", { error: "Enter a name (under 100 characters) and a valid role." });
  }

  const identity: Identity = {
    id: `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    role,
    institutionId: DEMO_INSTITUTION_ID,
    sector: "uni",
    profile: DEMO_PROFILE[role],
    orgName: DEMO_ORG_NAME,
    courseId: DEMO_COURSE_ID,
    owner: false,
  };
  return startSession(req, identity);
}
