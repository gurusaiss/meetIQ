import type { AssetStatus } from "../../src/types.ts";

export function StatusBadge({ status }: { status: AssetStatus }) {
  const cls = status === "approved" ? "b-approved" : status === "auto_held" ? "b-held" : "b-draft";
  const label = status === "auto_held" ? "auto-held" : status;
  return <span className={`badge ${cls}`}>{label}</span>;
}
