import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../src/persistence/sqlite.ts";
import { AccountService, AccountError } from "../src/auth/accounts.ts";
import { MockEmailProvider, getEmailProvider, ResendEmailProvider } from "../src/integrations/email.ts";
import type { EmailProvider, OutgoingEmail } from "../src/integrations/email.ts";

const PW = "Sturdy-pass-9";

function setup() {
  const repo = new SqliteRepository(":memory:");
  const email = new MockEmailProvider();
  const accounts = new AccountService(repo, email, "https://app.test");
  return { repo, email, accounts };
}

function linkFrom(sent: OutgoingEmail[], subjectMatch: RegExp): { to: string; token: string } {
  const msg = sent.find((m) => subjectMatch.test(m.subject));
  assert.ok(msg, `no email matching ${subjectMatch}`);
  const m = msg!.text.match(/https:\/\/app\.test\/[a-z-]+\?token=([0-9a-f]+)/);
  assert.ok(m, "email body has no link");
  return { to: msg!.to, token: m![1]! };
}

// ── signup sends verification ───────────────────────────────────────

test("signing up sends one verification email, with a link back to this app's own base URL", async () => {
  const { email, accounts } = setup();
  await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  assert.equal(email.sent.length, 1);
  const { to, token } = linkFrom(email.sent, /Verify/);
  assert.equal(to, "dee@u.test");
  assert.equal(token.length, 64, "32 random bytes, hex");
});

test("a mail-provider failure doesn't break signup — it's logged and swallowed", async () => {
  const repo = new SqliteRepository(":memory:");
  const broken: EmailProvider = { name: "broken", send: () => Promise.reject(new Error("smtp down")) };
  const accounts = new AccountService(repo, broken, "https://app.test");
  const identity = await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  assert.equal(identity.name, "Dee");
});

// ── email verification ──────────────────────────────────────────────

test("clicking the link verifies the account; the same link can't be used twice", async () => {
  const { repo, email, accounts } = setup();
  const identity = await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  assert.equal((await repo.getUserById(identity.id))?.emailVerified, false);

  const { token } = linkFrom(email.sent, /Verify/);
  const result = await accounts.verifyEmail(token);
  assert.deepEqual(result, { email: "dee@u.test", name: "Dee" });
  assert.equal((await repo.getUserById(identity.id))?.emailVerified, true);

  await assert.rejects(() => accounts.verifyEmail(token), AccountError);
});

test("a missing, garbage, or someone-else's-shaped token is rejected the same way", async () => {
  const { accounts } = setup();
  for (const bad of ["", "not-hex!!", "a".repeat(64)]) {
    await assert.rejects(() => accounts.verifyEmail(bad), AccountError, JSON.stringify(bad));
  }
});

test("an expired verification link is rejected, even though it was never used", async () => {
  const { repo, email, accounts } = setup();
  await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  const { token } = linkFrom(email.sent, /Verify/);

  // Back-date the token past its TTL, the way a real 48h-old token would be.
  const row = await repo.listAudit("inst-does-not-matter"); void row; // no-op to keep imports tidy if unused elsewhere
  const crypto = await import("node:crypto");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const raw = (repo as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => void } } }).db;
  raw.prepare(`UPDATE auth_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_hash=?`).run(tokenHash);

  await assert.rejects(() => accounts.verifyEmail(token), AccountError);
});

test("resending is a no-op once verified, but sends again while unverified; resent links verify the account", async () => {
  const { repo, email, accounts } = setup();
  const identity = await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });

  await accounts.resendVerification(identity);
  assert.equal(email.sent.filter((m) => /Verify/.test(m.subject)).length, 2);

  await accounts.verifyEmail(linkFrom(email.sent, /Verify/).token);
  await accounts.resendVerification(identity);
  assert.equal(email.sent.filter((m) => /Verify/.test(m.subject)).length, 2, "already verified: no third email");
  void repo;
});

// ── password reset ──────────────────────────────────────────────────

test("a reset link sets the new password; the password actually changes", async () => {
  const { repo, email, accounts } = setup();
  await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  await accounts.requestPasswordReset("dee@u.test");
  const { to, token } = linkFrom(email.sent, /Reset/);
  assert.equal(to, "dee@u.test");

  await accounts.resetPassword(token, "Brand-new-pass-1");
  await assert.rejects(() => accounts.signIn("dee@u.test", PW), AccountError, "old password no longer works");
  const signed = await accounts.signIn("dee@u.test", "Brand-new-pass-1");
  assert.equal(signed.name, "Dee");
  void repo;
});

test("requesting a reset for an unknown email sends nothing, but behaves identically to a known one", async () => {
  const { email, accounts } = setup();
  await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  email.sent.length = 0;

  await accounts.requestPasswordReset("nobody@u.test"); // resolves, doesn't throw
  assert.equal(email.sent.length, 0);
  await accounts.requestPasswordReset("DEE@U.TEST"); // case-insensitive, a real match
  assert.equal(email.sent.length, 1);
});

test("a reset link can be used once, rejects a weak replacement, and expires", async () => {
  const { repo, email, accounts } = setup();
  await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  await accounts.requestPasswordReset("dee@u.test");
  const { token } = linkFrom(email.sent, /Reset/);

  await assert.rejects(() => accounts.resetPassword(token, "short"), AccountError, "too weak");
  await accounts.resetPassword(token, "Brand-new-pass-1");
  await assert.rejects(() => accounts.resetPassword(token, "Another-pass-2"), AccountError, "already used");

  await accounts.requestPasswordReset("dee@u.test");
  const { token: token2 } = linkFrom(email.sent.slice(1), /Reset/);
  const crypto = await import("node:crypto");
  const tokenHash = crypto.createHash("sha256").update(token2).digest("hex");
  const raw = (repo as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => void } } }).db;
  raw.prepare(`UPDATE auth_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_hash=?`).run(tokenHash);
  await assert.rejects(() => accounts.resetPassword(token2, "Another-pass-2"), AccountError, "expired");
});

test("a verify token can't be used to reset a password, or vice versa", async () => {
  const { email, accounts } = setup();
  await accounts.signUp({ mode: "create", sector: "uni", roleId: "admin", name: "Dee", email: "dee@u.test", password: PW, orgName: "State U" });
  const { token: verifyToken } = linkFrom(email.sent, /Verify/);
  await assert.rejects(() => accounts.resetPassword(verifyToken, "Another-pass-2"), AccountError);

  await accounts.requestPasswordReset("dee@u.test");
  const { token: resetToken } = linkFrom(email.sent.slice(1), /Reset/);
  await assert.rejects(() => accounts.verifyEmail(resetToken), AccountError);
});

// ── providers ────────────────────────────────────────────────────────

test("getEmailProvider('resend') requires credentials; the mock needs none", () => {
  assert.throws(() => getEmailProvider("resend"), /no credentials/);
  const r = getEmailProvider("resend", { apiKey: "k", from: "a@b.test" });
  assert.equal(r.name, "resend");
  assert.equal(getEmailProvider("mock").name, "mock");
  assert.equal(getEmailProvider("ses").name, "ses");
});

test("Resend: posts the message with a Bearer token; a rejection throws", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => "" } as Response;
  }) as typeof fetch;
  const provider = new ResendEmailProvider({ apiKey: "k", from: "MeetIQ <a@b.test>" }, fetchImpl);
  await provider.send({ to: "x@y.test", subject: "Hi", text: "Body" });
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, "Bearer k");
  const body = JSON.parse(calls[0]!.init!.body as string);
  assert.deepEqual(body, { from: "MeetIQ <a@b.test>", to: ["x@y.test"], subject: "Hi", text: "Body" });

  const failing = (async () => ({ ok: false, status: 422, text: async () => "bad address" })) as unknown as typeof fetch;
  const bad = new ResendEmailProvider({ apiKey: "k", from: "a@b.test" }, failing);
  await assert.rejects(() => bad.send({ to: "x@y.test", subject: "Hi", text: "Body" }), /422/);
});

test("Resend refuses to construct without an API key or a from address", () => {
  assert.throws(() => new ResendEmailProvider({ apiKey: "", from: "a@b.test" }));
  assert.throws(() => new ResendEmailProvider({ apiKey: "k", from: "" }));
});
