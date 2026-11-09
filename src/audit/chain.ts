/**
 * Tamper-evident audit trail.
 *
 * Every audit event stores the hash of the one before it (per organisation),
 * so changing, deleting, inserting or reordering a past event breaks every
 * link after it and `verifyChain` says where. With `AUDIT_CHAIN_KEY` set the
 * hash is an HMAC, so someone who can only write to the database (a leaked
 * connection string, a careless DBA, SQL injection) can't simply recompute the
 * chain after editing a row; they would need the application's key too.
 *
 * What this does NOT do, and the audit page says so: it cannot detect the
 * newest events being deleted off the end (nothing later points back at them).
 * Recording the head hash somewhere outside this system (the export includes
 * it) closes that gap. The hash chain is evidence, not prevention.
 *
 * Pure functions, no I/O: the adapters call `eventHash` when appending, and
 * anyone can call `verifyChain` on a list of events.
 */
import { createHash, createHmac } from "node:crypto";
import type { Transcript } from "../types.ts";

/** The `prevHash` of an organisation's first chained event. */
export const GENESIS = "0".repeat(64);

export interface ChainableEvent {
  institutionId: string;
  actor: string;
  action: string;
  target: string;
  ts: string;
  /** Absent on events written before the chain existed ("legacy"). */
  hash?: string | null;
  prevHash?: string | null;
}

/** JSON-encoded as a tuple so no field can bleed into the next (no delimiter ambiguity). */
export function eventHash(prevHash: string, e: Omit<ChainableEvent, "hash" | "prevHash">, key?: string): string {
  const payload = JSON.stringify([prevHash, e.institutionId, e.actor, e.action, e.target, e.ts]);
  return key
    ? createHmac("sha256", key).update(payload).digest("hex")
    : createHash("sha256").update(payload).digest("hex");
}

export interface ChainVerification {
  ok: boolean;
  /** Events examined. */
  total: number;
  /** Events that are part of the chain and verified. */
  chained: number;
  /** Events from before the chain existed: shown, but not verifiable. */
  legacy: number;
  /** Hash of the newest verified event: the value to record outside the system. */
  head: string | null;
  /** True when the hashes are HMACs (AUDIT_CHAIN_KEY was supplied to verify). */
  keyed: boolean;
  /** 1-based position of the first event that failed, when `ok` is false. */
  brokenAt?: number;
  reason?: string;
}

/**
 * Walk `events` (oldest first) and check each link. Events written before the
 * chain existed are counted as `legacy` and skipped; once the chain has
 * started, every later event must be part of it: an unchained event after
 * that point means a row was inserted, or had its hash stripped.
 */
export function verifyChain(events: ChainableEvent[], key?: string): ChainVerification {
  let prev: string | null = null;
  let chained = 0;
  let legacy = 0;

  const fail = (index: number, reason: string): ChainVerification => ({
    ok: false, total: events.length, chained, legacy, head: prev, keyed: Boolean(key), brokenAt: index + 1, reason,
  });

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (!e.hash) {
      if (prev !== null) return fail(i, "An event without a hash appears after the chain began (a row was inserted, or its hash removed).");
      legacy++;
      continue;
    }
    const expectedPrev = prev ?? GENESIS;
    if (e.prevHash !== expectedPrev) {
      return fail(i, "This event does not follow the previous one (an event was removed, inserted or reordered).");
    }
    if (e.hash !== eventHash(expectedPrev, e, key)) {
      return fail(i, "This event's contents do not match its hash (it was altered, or AUDIT_CHAIN_KEY changed).");
    }
    prev = e.hash;
    chained++;
  }
  return { ok: true, total: events.length, chained, legacy, head: prev, keyed: Boolean(key) };
}

/**
 * A fingerprint of a transcript as it was when processing finished. Recorded
 * in the audit chain, so "this transcript is unchanged since it was produced"
 * can be shown later rather than asserted. Canonical form: fixed field order
 * and number formatting, so the same transcript always hashes the same.
 */
export function transcriptDigest(t: Transcript): string {
  const canonical = JSON.stringify([
    t.lectureId,
    t.language,
    t.provider,
    t.segments.map((s) => [s.id, s.start, s.end, s.speaker, s.text, s.confidence]),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
