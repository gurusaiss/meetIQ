import type { NextRequest } from "next/server";
import { isError } from "../../../lib/http.ts";
import { getAccounts } from "../../../lib/singletons.ts";
import { tooManyAttempts, startSession, redirectTo, field } from "../../../lib/session.ts";
import { AccountError, normalizeEmail } from "../../../../src/auth/accounts.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = field(form, "email", 255);
  const fail = (message: string) => redirectTo(req, "/login", { error: message, email });

  if (tooManyAttempts(req, normalizeEmail(email))) {
    return fail("Too many attempts. Please wait a minute and try again.");
  }
  try {
    const identity = await getAccounts().signIn(email, String(form.get("password") ?? ""));
    return startSession(req, identity);
  } catch (e) {
    if (isError(e, "AccountError")) return fail(e.message);
    console.error("signin.failed", e);
    return fail("Something went wrong signing you in. Please try again.");
  }
}
