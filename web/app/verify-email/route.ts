import { NextResponse, type NextRequest } from "next/server";
import { getAccounts } from "../../lib/singletons.ts";
import { isError } from "../../lib/http.ts";

/** Confirm an emailed verification link. No session is required: consuming the token is the proof. */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    await getAccounts().verifyEmail(token);
    return NextResponse.redirect(new URL("/?verified=1", req.url), { status: 303 });
  } catch (e) {
    if (isError(e, "AccountError")) {
      return NextResponse.redirect(new URL(`/account?error=${encodeURIComponent(e.message)}`, req.url), { status: 303 });
    }
    throw e;
  }
}
