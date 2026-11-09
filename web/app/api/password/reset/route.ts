import type { NextRequest } from "next/server";
import { getAccounts, getSessions } from "../../../../lib/singletons.ts";
import { redirectTo } from "../../../../lib/session.ts";
import { isError } from "../../../../lib/http.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (next !== confirm) {
    return redirectTo(req, "/reset-password", { token, error: "The two passwords do not match." });
  }
  try {
    const { userId } = await getAccounts().resetPassword(token, next);
    // A password reset means someone proved control of the inbox, not of any
    // existing session — sign every device out, this reset included.
    getSessions().revokeUser(userId);
    return redirectTo(req, "/login", { reset: "1" });
  } catch (e) {
    if (isError(e, "AccountError")) return redirectTo(req, "/reset-password", { token, error: e.message });
    throw e;
  }
}
