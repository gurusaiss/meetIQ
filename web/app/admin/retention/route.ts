import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../../lib/auth.ts";
import { getService } from "../../../lib/singletons.ts";
import { AuthorizationError } from "../../../../src/services/lecture-service.ts";
import { forbidResponse, isError } from "../../../lib/http.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["admin"])) return forbidResponse();
  const service = getService();

  try {
    const { purged, heldSkipped } = await service.runRetentionDetailed(identity!.institutionId, identity!);
    return NextResponse.redirect(new URL(`/audit?purged=${purged}&held=${heldSkipped}`, req.url), { status: 303 });
  } catch (e) {
    if (isError(e, "AuthorizationError")) return forbidResponse();
    throw e;
  }
}
