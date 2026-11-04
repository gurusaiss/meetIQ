import type { AssetStatus } from "../../src/types.ts";

export function StatusBadge({ status }: { status: AssetStatus }) {
  const cls = status === "approved" ? "b-approved" : status === "auto_held" ? "b-held" : "b-draft";
  const label = status === "auto_held" ? "auto-held" : status;
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function LectureStatusBadge({ status }: { status: string }) {
  const cls =
    status === "processed" ? "b-approved" : status === "processing" ? "b-processing" : status === "failed" ? "b-failed" : "b-draft";
  const label = status === "created" ? "ready to process" : status;
  return <span className={`badge ${cls}`}>{label}</span>;
}
