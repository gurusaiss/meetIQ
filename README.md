# MeetIQ

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
npm test               # pipeline + persistence + gates + isolation (61 tests)
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
- **Production hardening**: structured logging, health probes, session
  expiry + login rate limiting, strict CSP, secure cookies, graceful
  shutdown, and a handful of real bugs found by actually exercising the app
  end-to-end rather than just reading the code (documented candidly in
  `docs/DECISIONS.md` rather than swept under the rug).

## Roadmap

Not built yet, and why: a real async job queue (the pipeline currently runs
inline within one HTTP request — fine for Groq's fast inference, but a
genuine production system would decouple this with a worker + queue so a
slow provider can't hold a request open); real capture-system/LMS
integrations (Echo360/Canvas/etc. adapters exist as tested mocks with real
adapters stubbed to fail clearly, pending real institutional credentials).
