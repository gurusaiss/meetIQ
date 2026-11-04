import { NextResponse, type NextRequest } from "next/server";
import { getIdentity } from "../../../../lib/auth.ts";
import { getService } from "../../../../lib/singletons.ts";
import { AuthorizationError, NotFoundError } from "../../../../../src/services/lecture-service.ts";
import { forbidResponse, htmlError, isError } from "../../../../lib/http.ts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await getIdentity();
  if (!identity) return forbidResponse();
  const { id: assetId } = await params;
  const service = getService();

  try {
    const approved = await service.approveAsset(identity!.institutionId, assetId, identity);
    return NextResponse.redirect(
      new URL(`/lectures/${encodeURIComponent(approved.lectureId)}/review`, req.url),
      { status: 303 },
    );
  } catch (e) {
    if (isError(e, "AuthorizationError")) return forbidResponse();
    if (isError(e, "NotFoundError")) return htmlError(404, "<h1>Item not found</h1>");
    throw e;
  }
}
