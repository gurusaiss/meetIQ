import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../../lib/auth.ts";
import { getService, INSTITUTION_ID } from "../../../../lib/singletons.ts";
import { AuthorizationError } from "../../../../../src/services/lecture-service.ts";
import { forbidResponse } from "../../../../lib/http.ts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const { id: assetId } = await params;
  const service = getService();

  try {
    const approved = service.approveAsset(INSTITUTION_ID, assetId, identity);
    return NextResponse.redirect(
      new URL(`/lectures/${encodeURIComponent(approved.lectureId)}/review`, req.url),
      { status: 303 },
    );
  } catch (e) {
    if (e instanceof AuthorizationError) return forbidResponse();
    throw e;
  }
}
