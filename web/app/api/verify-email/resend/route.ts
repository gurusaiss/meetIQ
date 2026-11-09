import type { NextRequest } from "next/server";
import { getIdentity } from "../../../../lib/auth.ts";
import { getAccounts } from "../../../../lib/singletons.ts";
import { redirectTo, tooManyAttempts } from "../../../../lib/session.ts";
import { forbidResponse } from "../../../../lib/http.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  if (tooManyAttempts(req, `verify:${identity.id}`)) {
    return redirectTo(req, "/account", { error: "Too many attempts. Please wait a minute and try again." });
  }
  await getAccounts().resendVerification(identity);
  return redirectTo(req, "/account", { ok: "sent" });
}
