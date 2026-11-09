# MeetIQ.

> AI that turns any recorded meeting, lecture, or gathering into a searchable,
> verified knowledge base.

**Live demo:** https://meetiq-28lj.onrender.com _(Render free tier — first
load after inactivity can take 30-60s while the instance wakes up)_

---

## The problem

Recordings pile up — lectures, standups, all-hands, conference talks — and
almost nobody goes back and actually reviews them. The AI summarizers that
exist today make this worse in a specific way: they **hallucinate**. Ask a
generic chatbot to summarize a transcript and it will confidently state
things that were never actually said, with no way to tell which parts are
real and which are invented.

MeetIQ is built around one rule instead: **every generated statement must
cite the exact transcript moment it came from, and that citation is checked
in code, not just requested in a prompt.** If a statement can't be tied to a
real moment in the recording, it doesn't ship.

## How it works

```
transcribe → segment into topics → generate (notes / flashcards / quiz) → embed & index
                       └── confidence + grounding checked at every step ──┘
```

1. **Transcribe** the recording (real speech-to-text, with per-segment
   confidence — far-field/noisy audio scores lower, and that follows the
   content downstream instead of being silently smoothed over).
2. **Segment** the transcript into coherent topics.
3. **Generate** revision notes, flashcards, and a quiz from those topics —
   every single statement carries the transcript segment id(s) it's based on.
4. **Verify.** The hallucination guard (below) checks those citations against
   the real transcript before anything is stored. Statements that fail are
   dropped, not shipped with a caveat.
5. **Index & search.** Everything is embedded and stored so you can
   semantically search across every session later, with the same
   citation-back-to-the-exact-moment guarantee.

## The hallucination guard, concretely

This is the whole differentiator, so here it is in actual code —
[`src/pipeline/grounding.ts`](src/pipeline/grounding.ts), untouched since it
was first built:

```ts
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
```

The model can claim whatever citations it wants — `ground()` throws away any
citation that doesn't map to a **real** transcript segment (`segments.has(id)`),
and if nothing real is left, the statement is `ungrounded` and gets dropped
before it ever reaches storage (see `pipeline/assets.ts`). This is why the
LLM provider can be swapped (mock → Groq → Anthropic, see below) without
touching this file at all: grounding doesn't trust the model, it checks it.

Confidence is derived the same way — averaged from the *cited* segments'
own transcription confidence, so a statement built on mumbled, far-field
audio is visibly flagged even if it's technically grounded. Every statement
shown in the UI carries a visible **✓ Verified · X%** or **⚠ Low-confidence ·
X%** badge — this isn't something you have to take on faith or have
explained verbally, it's on screen next to every generated line.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router) | Route Handlers + Server Components for the whole flow |
| Language | TypeScript, Node 24 | native `.ts` execution (no build step for the API layer) |
| Transcription | **Groq Whisper** (`whisper-large-v3-turbo`) | free tier, real per-segment confidence via `avg_logprob` |
| Generation | **Groq LLM** (`openai/gpt-oss-120b`, JSON-schema strict mode) | free tier, constrained decoding guarantees valid structured output |
| Embeddings | **Local** (`@huggingface/transformers`, `all-MiniLM-L6-v2`, ONNX/WASM) | runs in-process — zero API key, zero network call, zero cost |
| Persistence | SQLite (dev) / Postgres+pgvector (prod) | same `Repository` interface, swappable via `REPO_DRIVER` |
| Deploy | Render (Docker) | matches the app's request-blocks-on-the-pipeline design — no serverless execution-time limit |

Every provider above sits behind a small interface
(`src/providers/{transcription,llm,embeddings}`) with a mock implementation
too — the whole pipeline runs with **zero API keys** on mocks, and the real
stack above needs exactly **one** key (`GROQ_API_KEY`, free, no card).

## Setup

```bash
npm install
npm run web            # zero-dep server at http://localhost:3000, mock providers
# or
cd web && npm install && npm run dev   # Next.js app, mock providers
```

### Turning on the real (free-tier) providers

```bash
cp .env.example .env
```
```env
TRANSCRIPTION_PROVIDER=groq
LLM_PROVIDER=groq
EMBEDDINGS_PROVIDER=local
GROQ_API_KEY=...          # console.groq.com — free, no card required
```
`EMBEDDINGS_PROVIDER=local` needs no key at all — it downloads a small
(~90MB) sentence-embedding model once and runs it in-process from then on.
The first request after a cold start pays that download cost (tens of
seconds); every request after is fast.

### Tests

```bash
npm test               # pipeline + persistence + gates + isolation + queue + integrations (204 tests; 17 of them need DATABASE_URL pointing at Postgres+pgvector and skip otherwise)
npm run typecheck
cd web && npm test      # builds the Next app + drives the full HTTP journey
```

## Layout

```
src/
  types.ts                 domain types — confidence + grounding are first-class
  pipeline/
    grounding.ts            the hallucination guard (see above)
    segment.ts               topic segmentation
    assets.ts                 notes + flashcards + quiz, quality-gated
    rag.ts                     chunking + semantic search with citations
  providers/
    transcription/          mock | assemblyai | groq
    llm/                     mock | anthropic | groq
    embeddings/              mock | local
  persistence/               Repository port: sqlite | postgres+pgvector adapters
  queue/                     JobQueue port: in-memory default, swappable backend
  integrations/              capture.ts (mock|zoom|echo360|panopto|kaltura), lms.ts (mock|slack|canvas|moodle|blackboard)
  services/lecture-service.ts  compliance gate + approval gate + audit, enforced
web/                        Next.js 16 App Router presentation layer
test/                       node:test suite
docs/DECISIONS.md            full engineering log (market research → every increment)
```

## What's already built, briefly

Full detail (every increment, every bug found and fixed, every trade-off) is
in [`docs/DECISIONS.md`](docs/DECISIONS.md). The short version:

- **Compliance-by-construction**, not a feature flag: an all-party-consent
  tenant can't process a recording until consent is recorded; nothing
  reaches a viewer until an approver explicitly releases it; every
  tenant is isolated by `institution_id` at the query level; every action
  is audited; retention purges old data automatically.
- **Two interchangeable presentation layers** — a zero-dependency Node
  `http` server and a full Next.js 16 App Router app — both driven by the
  identical service layer, so the gates you click are the gates the tests
  cover, not a UI-only reimplementation.
- **Two interchangeable persistence adapters** — SQLite (zero-dep, this
  deploy) and Postgres+pgvector (real vector columns, tested against a live
  instance) — behind one `Repository` port.
- **Accounts, fields and roles** (Next.js app): sign up by field (university,
  organisation, law, medical, training, government), create or join an
  organisation with an invite code, scrypt-hashed passwords, per-field role
  titles mapped onto five permission roles (student, faculty, ta, admin,
  read-only auditor), change-your-own-password, and admin-issued one-time
  temporary passwords (no email service needed). See [`DEMO.md`](DEMO.md). The zero-dependency server
  keeps its simple demo login.
- **Installable PWA** (Next.js app): web manifest, generated icons
  (`web/scripts/make-icons.mjs`), an "Install app" button, and a service worker
  that caches only static build assets and an offline page. Pages, API
  responses and transcripts are never cached, by design.
- **Production hardening**: structured logging, health probes, session
  expiry + login rate limiting, strict CSP, secure cookies, graceful
  shutdown (now draining the job queue before exit), and a handful of real
  bugs found by actually exercising the app end-to-end rather than just
  reading the code (documented candidly in `docs/DECISIONS.md` rather than
  swept under the rug).
- **Background job queue**: processing a recording (transcription + several
  LLM calls) no longer runs inline inside the HTTP request. `POST
  /lectures/:id/process` validates (status, consent) synchronously, flips
  the lecture to `processing`, and returns immediately — the pipeline itself
  runs on an in-process, bounded-concurrency queue (`src/queue/job-queue.ts`,
  `QUEUE_CONCURRENCY`), the same swappable-port pattern as every provider and
  the `Repository`. The dashboard shows `processing` as a normal transient
  state and polls itself until the job lands on `processed`/`failed`.
- **Real capture-system / LMS integrations** (moat #4): `CAPTURE_SOURCE=zoom`
  pulls real Zoom Cloud Recordings in — Server-to-Server OAuth, token
  caching, mapped to the same `ExternalRecording` shape Echo360/Panopto use
  (those three remain tested stubs pending institutional credentials).
  `LMS_CONNECTOR=slack` pushes approved notes/flashcards/quiz/decisions back
  out via an Incoming Webhook — the natural distribution target for a
  company/team, which doesn't have an LMS the way a university does.
  `LMS_CONNECTOR=canvas` is the university counterpart: each approved item
  becomes a Canvas Page in the course (stable slug, so re-publishing updates
  in place; Markdown is converted to HTML with everything escaped first).
  Moodle/Blackboard remain tested stubs. All default to `mock` so the
  import/publish flow is fully testable with zero credentials; see
  `src/integrations/capture.ts` and `src/integrations/lms.ts`.
- **Email verification and self-service password reset** (the roadmap's last
  named gap): signing up sends a verification link; a real adapter
  (`EMAIL_PROVIDER=resend`) now exists alongside the mock, following the same
  provider pattern as capture/LMS. "Forgot password" on the login page emails a
  reset link. Both are raw, single-use tokens (only their SHA-256 hash is
  stored — the same discipline as session tokens), time-limited (48h / 30min),
  and a reset signs out every other session on the account. A request for an
  unknown email behaves identically to a known one (same redirect, same
  rate-limit bucket) so the response can't be used to find out who has an
  account. A failed send (bad key, provider outage) never blocks signup — the
  person can always ask to resend from their account page.
- **Multiple courses per organisation** (University-first; the same mechanism is
  a "project", "matter", "cohort"... in the other fields). Each course keeps its
  own recordings, search and action items; faculty and admins create them, admins
  archive them, and a nav chip shows which one you're in. Access is enforced in
  the service, not the pages: staff (faculty/TA/admin) can open every course in
  their organisation; students and auditors can open the organisation's original
  course (so a single-course organisation behaves exactly as before, with nothing
  to migrate) plus any course they've **enrolled** in with its join code. A
  lecture in a course you can't reach is reported as "not found", the same as one
  that doesn't exist, across the student view, transcript, exports, flowchart,
  slides, search and the action tracker. The "current course" is only a cookie
  preference that is re-checked against your access on every request, so a forged
  value does nothing. Join codes can be replaced (revoking the old one), people
  can be removed (access ends at once), and bad codes all get one identical reply.
  Each course also has its own LMS/capture id, so importing and publishing go to
  the right Canvas course instead of one shared value.
- **Action tracker** (Company-first): `/actions` lists every action item from
  your approved meetings in one place, with open/done/unassigned counts and an
  "Assigned to me" view. Staff assign items to a named person and tick them off;
  everyone else reads. Only items from an *approved* actions set ever appear, so
  the tracker never surfaces unreleased AI output. Each change is audited, and
  the dashboard shows how many items are still open. The transcript's speaker
  label is shown only as a hint ("said by SPEAKER_0"); an assignee is a person
  staff typed, never inferred.
- **Legal & audit completion**:
  - **Tamper-evident audit trail.** Each event is hash-chained to the previous one
    (per organisation); the audit page verifies the chain and says "Chain broken
    at event N" if a row was edited, removed, inserted or reordered. Optional
    `AUDIT_CHAIN_KEY` makes the hashes HMACs, so a database-only attacker can't
    recompute them. Auditors can export CSV/JSON with the verdict and every hash
    (exporting is itself logged; CSV cells are defused against formula injection).
    The chain can't see the *newest* events being deleted, so the audit page shows
    the head hash to record outside the system. It is evidence, not prevention.
  - **Legal hold.** Any staff role can place one (with a reason or matter
    reference); only an admin can release it. While held, a recording can't be
    deleted by anyone and retention skips it (and says so), because deleting held
    material is spoliation. A preservation order outranks an erasure request.
  - **Transcript fingerprint.** A digest of each transcript is recorded in the
    chain when processing finishes; the transcript page re-checks it and flags
    "changed since it was produced" if it no longer matches, so a deposition
    transcript's integrity can be shown rather than asserted.
  - Existing databases upgrade in place (guarded column migrations; older audit
    events show as "legacy" and the chain starts after them), tested on both
    SQLite and a real Postgres.
- **University completion**: a transcript page with SRT/VTT/TXT caption
  downloads (the accessibility surface universities must provide). The
  transcript is raw speech recognition, so it follows the same release rule as
  everything else: staff always see it, students and auditors only after
  something has been approved and released; exports are audited, and
  low-confidence lines are marked rather than hidden. The University field also
  gains a Teaching Assistant role (mapped to the `ta` permission role).

## Roadmap

Not built yet, and why: the university/legal-specific capture and LMS
adapters (Echo360, Panopto, Kaltura, Moodle, Blackboard) — real adapters
now exist for Zoom, Slack and Canvas (see above); the rest are tested stubs
pending institutional API/LTI credentials, same shape, just not built yet.
Also not built: employees ticking off their own items (an assignee is free text,
so matching it to a signed-in person would be unreliable; staff update items for
now), reminders/notifications for overdue items, due dates; per-course staff
assignment (every staff member can open every course in their organisation, and a
TA is not limited to the courses they assist); bulk enrolment from an LMS roster
(students enrol with a code); deleting a course (it can only be archived); the
per-field wording for "course" (project, matter, cohort...) is a first guess you
may want to reword in `src/auth/sectors.ts`; redaction of a transcript before
release; privilege tagging. The zero-dependency server stays single-course.
