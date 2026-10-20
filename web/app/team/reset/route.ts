import type { NextRequest } from "next/server";
import { getIdentity } from "../../../lib/auth.ts";
import { getAccounts } from "../../../lib/singletons.ts";
import { redirectTo, field } from "../../../lib/session.ts";
import { forbidResponse } from "../../../lib/http.ts";
import { putFlash } from "../../../lib/flash.ts";
import { AccountError } from "../../../../src/auth/accounts.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity || identity.role !== "admin") return forbidResponse();
  const form = await req.formData();
  try {
    const result = await getAccounts().resetMemberPassword(identity, field(form, "email", 255));
    return redirectTo(req, `/team/reset/${putFlash(identity.id, result)}`);
  } catch (e) {
    if (e instanceof AccountError) return redirectTo(req, "/team", { error: e.message });
    throw e;
  }
}
