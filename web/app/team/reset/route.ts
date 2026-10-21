import type { NextRequest } from "next/server";
import { getIdentity } from "../../../lib/auth.ts";
import { getAccounts, getSessions } from "../../../lib/singletons.ts";
import { redirectTo, field } from "../../../lib/session.ts";
import { forbidResponse, isError } from "../../../lib/http.ts";
import { putFlash } from "../../../lib/flash.ts";
import { AccountError } from "../../../../src/auth/accounts.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity || identity.role !== "admin") return forbidResponse();
  const form = await req.formData();
  try {
    const result = await getAccounts().resetMemberPassword(identity, field(form, "email", 255));
    getSessions().revokeUser(result.id);
    return redirectTo(req, `/team/reset/${putFlash(identity.id, { name: result.name, email: result.email, temporary: result.temporary })}`);
  } catch (e) {
    if (isError(e, "AccountError")) return redirectTo(req, "/team", { error: e.message });
    throw e;
  }
}
