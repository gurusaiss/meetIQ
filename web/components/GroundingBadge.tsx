/**
 * Makes the hallucination guard's verdict on ONE statement visible, not
 * just something explained verbally. Every statement that reaches this
 * component already passed grounding.ts (ungrounded ones are dropped
 * before storage — see pipeline/assets.ts) — so this never renders
 * "unverified"; it renders confidence, which is the more honest thing
 * to show once a statement is already known to cite a real segment.
 */
export function GroundingBadge({
  confidence,
  flagged,
}: {
  confidence: number;
  flagged: boolean;
}) {
  const pct = Math.round(confidence * 100);
  return (
    <span className={`badge gbadge ${flagged ? "b-held" : "b-approved"}`} style={{ marginLeft: 6 }}>
      {flagged ? `⚠ Low-confidence · ${pct}%` : `✓ Verified · ${pct}%`}
    </span>
  );
}
