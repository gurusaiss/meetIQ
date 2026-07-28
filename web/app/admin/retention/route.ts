import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../../lib/auth.ts";
import { getService, INSTITUTION_ID } from "../../../lib/singletons.ts";
import { AuthorizationError } from "../../../../src/services/lecture-service.ts";
import { forbidResponse } from "../../../lib/http.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["admin"])) return forbidResponse();
  const service = getService();

  try {
    await service.runRetention(INSTITUTION_ID, identity!);
  } catch (e) {
    if (e instanceof AuthorizationError) return forbidResponse();
    throw e;
  }
  return NextResponse.redirect(new URL("/audit", req.url), { status: 303 });
}
