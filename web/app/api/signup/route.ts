import type { NextRequest } from "next/server";
import { isError } from "../../../lib/http.ts";
import { getAccounts } from "../../../lib/singletons.ts";
import { tooManyAttempts, startSession, redirectTo, field } from "../../../lib/session.ts";
import { AccountError, normalizeEmail } from "../../../../src/auth/accounts.ts";
import { getSector } from "../../../../src/auth/sectors.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const sector = getSector(field(form, "sector", 20));
  if (!sector) return redirectTo(req, "/signup", { error: "Choose your field first." });

  const mode = field(form, "mode", 10) === "join" ? "join" : "create";
  const name = field(form, "name", 101);
  const email = field(form, "email", 255);
  const orgName = field(form, "orgName", 81);
  const roleId = field(form, "roleId", 30);
  // Everything but the password and invite code is handed back so a typo doesn't cost the whole form.
  const keep = { mode, name, email, org: orgName, role: roleId };
  const fail = (message: string) => redirectTo(req, `/signup/${sector.id}`, { ...keep, error: message });

  if (tooManyAttempts(req, normalizeEmail(email))) {
    return fail("Too many attempts. Please wait a minute and try again.");
  }

  try {
    const identity = await getAccounts().signUp({
      mode,
      sector: sector.id,
      roleId,
      name,
      email,
      password: String(form.get("password") ?? ""),
      orgName,
      joinCode: field(form, "joinCode", 40),
    });
    return startSession(req, identity, "/?welcome=1");
  } catch (e) {
    if (isError(e, "AccountError")) return fail(e.message);
    console.error("signup.failed", e);
    return fail("Something went wrong creating your account. Please try again.");
  }
}
