import type { NextRequest } from "next/server";
import { isError } from "../../../lib/http.ts";
import { cookies } from "next/headers";
import { getIdentity, COOKIE_NAME } from "../../../lib/auth.ts";
import { getAccounts, getSessions } from "../../../lib/singletons.ts";
import { redirectTo } from "../../../lib/session.ts";
import { AccountError } from "../../../../src/auth/accounts.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return redirectTo(req, "/login");
  const form = await req.formData();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (next !== confirm) return redirectTo(req, "/account", { error: "The two new passwords do not match." });
  try {
    await getAccounts().changePassword(identity, current, next);
    // Sign out every other device; this one stays signed in.
    getSessions().revokeUser(identity.id, (await cookies()).get(COOKIE_NAME)?.value);
    return redirectTo(req, "/account", { ok: "1" });
  } catch (e) {
    if (isError(e, "AccountError")) return redirectTo(req, "/account", { error: e.message });
    throw e;
  }
}
