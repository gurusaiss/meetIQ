import { NextResponse } from "next/server";
import { getRepo } from "../../lib/singletons.ts";

export async function GET() {
  const dbOk = getRepo().healthcheck();
  return NextResponse.json(
    { status: dbOk ? "ok" : "degraded", db: dbOk ? "ok" : "down" },
    { status: dbOk ? 200 : 503 },
  );
}
