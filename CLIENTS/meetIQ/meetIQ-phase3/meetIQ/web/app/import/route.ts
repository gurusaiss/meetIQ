import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../lib/auth.ts";
import { getService, EXTERNAL_COURSE } from "../../lib/singletons.ts";
import { getCaptureSource } from "../../../src/integrations/capture.ts";
import { forbidResponse } from "../../lib/http.ts";

export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!hasRole(identity, ["faculty", "ta", "admin"])) return forbidResponse();

  await getService().importFromCapture(
    identity!.institutionId,
    identity!.courseId!,
    getCaptureSource("mock"),
    EXTERNAL_COURSE,
    identity!,
  );
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
