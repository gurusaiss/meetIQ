import type { NextRequest } from "next/server";
import { getAccounts } from "../../../../lib/singletons.ts";
import { redirectTo, tooManyAttempts, field } from "../../../../lib/session.ts";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = field(form, "email", 254);
  // Deliberately generic either way: the same redirect, the same rate-limit
  // treatment, regardless of whether the email has an account. See
  // AccountService.requestPasswordReset for why that matters.
  if (!tooManyAttempts(req, `reset:${email.toLowerCase()}`)) {
    await getAccounts().requestPasswordReset(email);
  }
  return redirectTo(req, "/forgot-password", { sent: "1" });
}
