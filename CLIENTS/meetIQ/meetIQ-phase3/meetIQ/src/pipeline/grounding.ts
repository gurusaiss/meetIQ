import type { GroundedStatement, TranscriptSegment } from "../types.ts";
import type { StatementDraft } from "../providers/llm/types.ts";

/**
 * The hallucination guard + confidence propagation, in one place.
 *
 * Rule: a generated statement is only as trustworthy as the transcript it
 * cites. We (1) discard any claimed source ref that doesn't map to a real
 * segment, (2) derive the statement's confidence from the cited segments,
 * and (3) flag it when that confidence is below the far-field threshold.
 *
 * A statement with zero valid refs is `ungrounded` — the caller decides
 * whether to drop or surface it, but it can never masquerade as grounded.
 */
export function ground(
  draft: StatementDraft,
  segments: Map<string, TranscriptSegment>,
  flagThreshold: number,
): GroundedStatement & { ungrounded: boolean } {
  const validRefs = draft.sourceRefs.filter((id) => segments.has(id));
  const confidences = validRefs.map((id) => segments.get(id)!.confidence);
  const confidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;
  const ungrounded = validRefs.length === 0;
  return {
    text: draft.text,
    sourceRefs: validRefs,
    confidence,
    flagged: ungrounded || confidence < flagThreshold,
    ungrounded,
  };
}

/** Aggregate quality metrics over a set of grounded statements (NFR-1). */
export function assetQuality(
  statements: Array<{ flagged: boolean; ungrounded: boolean }>,
): { flagRatio: number; ungroundedRatio: number } {
  const n = statements.length || 1;
  return {
    flagRatio: statements.filter((s) => s.flagged).length / n,
    ungroundedRatio: statements.filter((s) => s.ungrounded).length / n,
  };
}
