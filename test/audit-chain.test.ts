import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { eventHash, verifyChain, transcriptDigest, GENESIS, type ChainableEvent } from "../src/audit/chain.ts";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import type { Transcript } from "../src/types.ts";

/** Build a correctly chained list the way an adapter would. */
function chain(n: number, key?: string): ChainableEvent[] {
  const out: ChainableEvent[] = [];
  let prev = GENESIS;
  for (let i = 0; i < n; i++) {
    const e = { institutionId: "inst", actor: `a${i}`, action: "x.did", target: `t${i}`, ts: `2026-01-01T00:00:0${i}.000Z` };
    const hash = eventHash(prev, e, key);
    out.push({ ...e, hash, prevHash: prev });
    prev = hash;
  }
  return out;
}

// ── the pure chain ──────────────────────────────────────────────────

test("an untouched chain verifies, and reports the head hash to record elsewhere", () => {
  const ev = chain(5);
  const v = verifyChain(ev);
  assert.equal(v.ok, true);
  assert.equal(v.chained, 5);
  assert.equal(v.legacy, 0);
  assert.equal(v.head, ev[4]!.hash);
  assert.equal(v.keyed, false);
});

test("an empty trail is trivially fine", () => {
  const v = verifyChain([]);
  assert.deepEqual([v.ok, v.total, v.head], [true, 0, null]);
});

test("altering any field of any event is detected, and pinpointed", () => {
  for (const field of ["actor", "action", "target", "ts", "institutionId"] as const) {
    const ev = chain(5);
    ev[2] = { ...ev[2]!, [field]: "tampered" };
    const v = verifyChain(ev);
    assert.equal(v.ok, false, field);
    assert.equal(v.brokenAt, 3, `${field}: points at the altered event`);
  }
});

test("deleting an event from the middle, inserting one, or reordering is detected", () => {
  const removed = chain(5);
  removed.splice(2, 1);
  assert.equal(verifyChain(removed).ok, false);
  assert.equal(verifyChain(removed).brokenAt, 3);

  const reordered = chain(5);
  [reordered[1], reordered[2]] = [reordered[2]!, reordered[1]!];
  assert.equal(verifyChain(reordered).ok, false);

  const inserted = chain(5);
  inserted.splice(2, 0, { institutionId: "inst", actor: "mallory", action: "x.did", target: "evil", ts: "2026-01-01T00:00:09.000Z", hash: "f".repeat(64), prevHash: inserted[1]!.hash! });
  assert.equal(verifyChain(inserted).ok, false);
});

test("known limit: deleting the NEWEST events is not detectable from the chain alone (the head hash exists to cover this)", () => {
  const full = chain(5);
  const truncated = full.slice(0, 3);
  assert.equal(verifyChain(truncated).ok, true, "still a valid chain, just shorter");
  assert.notEqual(verifyChain(truncated).head, verifyChain(full).head, "but an externally recorded head would no longer match");
});

test("events from before the chain existed are counted as legacy, not failures; but not after it starts", () => {
  const legacy: ChainableEvent[] = [
    { institutionId: "inst", actor: "old", action: "lecture.created", target: "l1", ts: "2025-01-01T00:00:00.000Z", hash: null, prevHash: null },
    { institutionId: "inst", actor: "old", action: "lecture.created", target: "l2", ts: "2025-01-02T00:00:00.000Z" },
  ];
  const mixed = [...legacy, ...chain(3)];
  const v = verifyChain(mixed);
  assert.equal(v.ok, true);
  assert.equal(v.legacy, 2);
  assert.equal(v.chained, 3);

  // An unhashed row appearing AFTER the chain began is an insertion (or a stripped hash).
  const stripped = chain(4);
  stripped[2] = { ...stripped[2]!, hash: null, prevHash: null };
  const bad = verifyChain(stripped);
  assert.equal(bad.ok, false);
  assert.equal(bad.brokenAt, 3);
});

test("with a key the hashes are HMACs: the wrong or a missing key fails, so DB-only access cannot recompute the chain", () => {
  const ev = chain(3, "s3cret");
  assert.equal(verifyChain(ev, "s3cret").ok, true);
  assert.equal(verifyChain(ev, "s3cret").keyed, true);
  assert.equal(verifyChain(ev, "wrong").ok, false);
  assert.equal(verifyChain(ev).ok, false);
  assert.notEqual(chain(1)[0]!.hash, chain(1, "s3cret")[0]!.hash);
});

test("fields cannot bleed into each other: ('ab','c') and ('a','bc') hash differently", () => {
  const base = { institutionId: "i", ts: "t" };
  assert.notEqual(
    eventHash(GENESIS, { ...base, actor: "ab", action: "c", target: "x" }),
    eventHash(GENESIS, { ...base, actor: "a", action: "bc", target: "x" }),
  );
});

test("transcriptDigest is stable, and changes if a single word does", () => {
  const t: Transcript = {
    lectureId: "l", language: "en", provider: "mock",
    segments: [{ id: "s1", start: 0, end: 2, speaker: "A", text: "I agree.", confidence: 0.9 }],
  };
  assert.equal(transcriptDigest(t), transcriptDigest(JSON.parse(JSON.stringify(t))));
  const edited = { ...t, segments: [{ ...t.segments[0]!, text: "I do not agree." }] };
  assert.notEqual(transcriptDigest(t), transcriptDigest(edited));
});

// ── the SQLite adapter ──────────────────────────────────────────────

const ev = (i: number, inst = "inst-a") => ({ institutionId: inst, actor: `a${i}`, action: "x.did", target: `t${i}`, ts: new Date(1_700_000_000_000 + i * 1000).toISOString() });

test("the adapter chains every appended event, per organisation", async () => {
  const repo = new SqliteRepository(":memory:");
  await repo.audit(ev(1));
  await repo.audit(ev(2));
  await repo.audit(ev(1, "inst-b"));
  const a = await repo.listAudit("inst-a");
  assert.equal(a.length, 2);
  assert.equal(a[0]!.prevHash, GENESIS);
  assert.equal(a[1]!.prevHash, a[0]!.hash);
  assert.equal(verifyChain(a).ok, true);
  const b = await repo.listAudit("inst-b");
  assert.equal(b[0]!.prevHash, GENESIS, "another organisation has its own chain, starting fresh");
  await repo.close();
});

test("editing or deleting a row directly in the database is caught on verify", async () => {
  const file = join(tmpdir(), `lip-chain-${process.pid}-${Date.now()}.sqlite`);
  try {
    const repo = new SqliteRepository(file);
    for (let i = 1; i <= 4; i++) await repo.audit(ev(i));
    assert.equal(verifyChain(await repo.listAudit("inst-a")).ok, true);

    // Someone with write access to the file rewrites history behind the app's back.
    const raw = new DatabaseSync(file);
    raw.prepare(`UPDATE audit SET actor='nobody' WHERE target='t2'`).run();
    const edited = verifyChain(await repo.listAudit("inst-a"));
    assert.equal(edited.ok, false);
    assert.equal(edited.brokenAt, 2);

    raw.prepare(`UPDATE audit SET actor='a2' WHERE target='t2'`).run();
    assert.equal(verifyChain(await repo.listAudit("inst-a")).ok, true, "putting it back restores the chain");

    raw.prepare(`DELETE FROM audit WHERE target='t2'`).run();
    assert.equal(verifyChain(await repo.listAudit("inst-a")).ok, false, "a deleted row breaks the link");
    raw.close();
    await repo.close();
  } finally {
    rmSync(file, { force: true });
  }
});

test("with a key, a database writer who recomputes plain SHA-256 hashes still fails verification", async () => {
  const repo = new SqliteRepository(":memory:", { auditKey: "k3y" });
  await repo.audit(ev(1));
  await repo.audit(ev(2));
  const events = await repo.listAudit("inst-a");
  assert.equal(verifyChain(events, "k3y").ok, true);
  assert.equal(verifyChain(events).ok, false, "plain SHA-256 does not reproduce an HMAC chain");
  await repo.close();
});

test("a database from before this release upgrades in place: old rows become legacy, new events chain after them", async () => {
  const file = join(tmpdir(), `lip-old-${process.pid}-${Date.now()}.sqlite`);
  try {
    // The exact shape an older version created: no hash/hold columns.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE audit (institution_id TEXT, actor TEXT, action TEXT, target TEXT, ts TEXT);
      CREATE TABLE lectures (id TEXT PRIMARY KEY, institution_id TEXT, course_id TEXT, media_ref TEXT,
        status TEXT, capture_source TEXT, created_at TEXT);
      INSERT INTO audit VALUES ('inst-a','old','lecture.created','l1','2025-01-01T00:00:00.000Z');
      INSERT INTO audit VALUES ('inst-a','old','lecture.processed','l1','2025-01-01T00:01:00.000Z');
      INSERT INTO lectures VALUES ('l1','inst-a','c1','media://x','processed','upload','2025-01-01T00:00:00.000Z');
    `);
    old.close();

    const repo = new SqliteRepository(file);
    assert.equal((await repo.getLecture("inst-a", "l1"))?.hold, undefined, "an existing lecture is simply not on hold");

    await repo.audit(ev(1));
    const events = await repo.listAudit("inst-a");
    assert.equal(events.length, 3);
    const v = verifyChain(events);
    assert.deepEqual([v.ok, v.legacy, v.chained], [true, 2, 1]);
    assert.equal(events[2]!.prevHash, GENESIS, "the chain starts fresh after the legacy rows");

    await repo.setLegalHold("inst-a", "l1", { reason: "Matter 42", by: "pat", at: "2026-01-01T00:00:00.000Z" });
    assert.equal((await repo.getLecture("inst-a", "l1"))?.hold?.reason, "Matter 42");
    await repo.close();

    // And opening it again (the migration runs on every start) is a no-op, not an error.
    const again = new SqliteRepository(file);
    assert.equal((await again.getLecture("inst-a", "l1"))?.hold?.by, "pat");
    await again.close();
  } finally {
    rmSync(file, { force: true });
  }
});
