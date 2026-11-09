import { NextResponse, type NextRequest } from "next/server";
import { getIdentity, hasRole } from "../../../lib/auth.ts";
import { getService } from "../../../lib/singletons.ts";
import { auditToCsv, auditToJson } from "../../../../src/export/exporters.ts";
import { forbidResponse, isError } from "../../../lib/http.ts";

/** Audit trail download for auditors: CSV or JSON, with the tamper-check verdict and per-event hashes. */
export async function GET(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  if (!hasRole(identity, ["admin", "auditor"])) return forbidResponse();

  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
  try {
    const { events, verification } = await getService().exportAuditTrail(identity.institutionId, identity);
    const body = format === "json" ? auditToJson(events, verification) : auditToCsv(events, verification);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": `${format === "json" ? "application/json" : "text/csv"}; charset=utf-8`,
        "content-disposition": `attachment; filename="audit-trail.${format}"`,
        "x-audit-chain": verification.ok ? "verified" : "broken",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (isError(e, "AuthorizationError")) return forbidResponse();
    throw e;
  }
}
