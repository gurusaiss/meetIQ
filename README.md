# Lecture Intelligence Platform (LIP)

> The compliant AI layer that turns a university's in-person lecture recordings into
> study-ready, searchable knowledge — installed alongside Echo360/Panopto, not instead of them.

This repo is the product of a phased founder/engineering process. See
[`docs/DECISIONS.md`](docs/DECISIONS.md) for the full market rationale and the
architecture/technology decisions (compressed Phases 5–15).

**Beachhead:** higher-education lecture intelligence.
**Moats:** (1) far-field audio + confidence transparency, (2) compliance-first
(FERPA/consent), (3) depth in 3 reused outputs, (4) integration with capture incumbents.

---

## What's built (Increment 1: the value engine)

A runnable, tested TypeScript core of the AI pipeline (Phase 11):

```
transcribe → topic-segment → [revision notes | flashcards | quiz] → embed / RAG index
             └── with confidence propagation + a hallucination guard threaded through ──┘
```

It runs **with zero API keys and zero infrastructure** using mock providers.
Real engines (AssemblyAI transcription, Claude generation, real embeddings) are
drop-in behind stable provider interfaces — set env vars, no pipeline changes.

### Why this core first
It's the heart of the product and the home of the two hardest moats:
- **Moat #1 (far-field trust):** every transcript segment carries a confidence
  score; low-confidence (reverberant/distant) audio is flagged and propagates to
  any note/card/quiz derived from it. Assets that are too shaky are `auto_held`
  for faculty review instead of shipped to students.
- **Hallucination guard:** every generated statement must cite real transcript
  segment ids. The pipeline validates those ids — an LLM cannot fake grounding.
  Ungrounded statements are dropped (quiz/flashcards) or excluded (notes).

## What's built (Increment 2: persistence + service layer)

The pipeline output now survives, and two moats become *enforced rules* rather
than data fields, via a **ports-and-adapters** design (a `Repository` interface
with a zero-dependency adapter on Node's built-in SQLite; Postgres+pgvector is
the drop-in prod adapter):

- **Compliance gate (moat #2):** an all-party-consent tenant cannot process a
  lecture until a consent notice is recorded — `processLecture` throws otherwise.
- **Faculty approval gate (FR-14):** only faculty/TA can approve an asset;
  students only ever see `approved` assets.
- **Tenant isolation:** every query is scoped by `institution_id`; a wrong-tenant
  id returns nothing (tested).
- **Audit trail:** every state change is logged for the security/privacy officer.
- **Persisted course search:** "chat with the course" runs over stored chunks
  with timestamp citations.

## What's built (Increment 3: the clickable web UI)

A server-rendered web app (zero-dependency, on Node's built-in `http`) that
**reuses `LectureService` directly** — so the gates you click are the same
enforced code the tests cover, not a UI reimplementation. Screens:

- **Dashboard** — create a lecture (with a consent checkbox), process it.
- **Faculty review** — assets shown with status badges; **low-confidence
  far-field spans highlighted inline** with "verify" warnings; auto-held banner;
  one-click *Approve & release*. Nothing reaches students unapproved.
- **Student view** — approved materials only, now **interactive**: click-to-flip
  flashcards and a self-grading quiz runner (vanilla JS). Plus one-click
  **exports**: Markdown notes, **Anki-CSV flashcards**, Markdown quiz + answer key.
- **Search** — "chat with the course" with timestamp citations.
- **Audit** — the full compliance trail (admin only).

Theme-aware (light/dark), responsive. Migrates to Next.js (the Phase 10 target)
once flows are proven; built runnably first so it can be verified today.

## What's built (Increment 5: auth + RBAC + retention)

- **Sign-in / sessions** — a `/login` identity chooser standing in for SSO
  (SAML/LTI is the drop-in prod adapter behind the same `Session` shape).
- **Role-based access** on every route: students can't create/process/approve
  or see the audit log (403); faculty/TA review & approve; admin runs audit +
  retention. Enforced in both the service and the web layer.
- **Right-to-erasure** — faculty/admin can delete a lecture and *all* derived
  data (transcript, assets, chunks, consent).
- **Retention** — admin runs a purge of lectures older than the tenant's
  `retentionDays` (moat #2).

## What's built (Increment 6: integrations — moat #4)

- **Capture import** — pull recordings from Echo360/Panopto/Kaltura as lectures
  (idempotent; consent seeded from the source). Mock source runs credential-free.
- **LMS push** — deliver *approved* assets into Canvas/Moodle/Blackboard so
  students stay in the tool they already use. Mock connector runs credential-free.
- Both are ports-and-adapters (real vendor adapters are stubs that fail clearly
  pending credentials), role-gated, and audited.

## What's built (Increment 7: hardening & observability)

- **Structured JSON logging** with per-request correlation ids (`x-request-id`).
- **Startup config validation** — bad provider names, out-of-range thresholds, or
  a real provider selected without its key fail fast with a clear message.
- **Health probes** — `GET /healthz` / `/readyz` check the datastore.
- **Graceful shutdown** on SIGTERM/SIGINT (the container path) and SIGBREAK.
- 500 responses no longer leak internal error details to clients.

## What's built (Increment 9: session lifecycle + accessibility)

- **Session expiry** — sessions now time out after 8 hours instead of living
  forever; login is rate-limited (10/min per client) against brute-force abuse.
- **Accessibility (NFR-6)** — every form label is programmatically associated
  with its input (`for`/`id`), a skip-to-content link, a `<main>` landmark,
  and visible focus outlines.

## Quick start

```bash
# no install needed to run — mock providers + built-in SQLite, Node 22+ strips the TS
npm run web           # ← the app at http://localhost:3000
npm run demo          # value-engine pipeline on the sample far-field lecture
npm run demo:service  # full institutional lifecycle (consent→process→approve→search→audit)
npm test              # 14 tests (pipeline + persistence + gates + isolation)

# optional, for the type layer:
npm install
npm run typecheck
```

Requires **Node 24+** (TypeScript type-stripping + `node:sqlite` with no extra flags).

## Deploy

```bash
docker compose up --build      # app on http://localhost:3000, data in a volume
```

The image runs the app directly (no build step — Node strips types at runtime)
with a `/healthz` container healthcheck. `docker-compose.yml` also scaffolds the
future production dependencies (Postgres+pgvector, Redis for the pipeline worker,
MinIO for media), commented out until those adapters land.

CI (`.github/workflows/ci.yml`) runs `typecheck` + the full test suite on every
push/PR.

### Using real providers
The real engines are implemented (AssemblyAI transcription via `fetch`; Claude
generation via the official `@anthropic-ai/sdk` with structured outputs, model
read from `LLM_MODEL`). Copy `.env.example` → `.env` and set:
```
TRANSCRIPTION_PROVIDER=assemblyai
ASSEMBLYAI_API_KEY=...
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
LLM_MODEL=claude-sonnet-5   # or claude-opus-4-8
```
The Claude provider requires the model to cite transcript segment ids for every
generated statement; the pipeline's grounding guard then validates them, so the
hallucination guard protects the real path exactly as it does the mock path.
Mock stays the default and loads no SDK (the SDK is dynamic-import-gated).

> Status: the real provider bodies are implemented against the current APIs and
> typecheck clean, but have **not** yet been exercised against the live services
> in this repo (no API keys here). Add keys to smoke-test end-to-end.

## Layout

```
docs/DECISIONS.md          market + architecture decisions (Phases 5–15)
src/
  types.ts                 domain types (confidence + grounding are first-class)
  config.ts                env-driven config, safe mock defaults
  providers/
    transcription/         mock | assemblyai (swappable — moat #1)
    llm/                   mock | anthropic  (returns drafts with claimed refs)
    embeddings/            mock (pgvector-backed in Inc 2)
  pipeline/
    grounding.ts           hallucination guard + confidence propagation
    segment.ts             topic segmentation
    assets.ts              notes + flashcards + quiz, with quality gates
    rag.ts                 chunking + semantic search with citations
    pipeline.ts            orchestrator
  persistence/
    repository.ts          Repository PORT (tenant-scoped interface)
    sqlite.ts              zero-dep adapter (built-in node:sqlite)
  services/
    lecture-service.ts     lifecycle + compliance gate + faculty approval + audit
  demo.ts                  value-engine demo
  demo-service.ts          full institutional lifecycle demo
sample-data/               far-field lecture fixture (has low-confidence segments)
test/                      node:test suite
web/                       Next.js 15 App Router presentation layer (see below)
```

## What's built (Increment 10: Next.js presentation layer)

A second, real Next.js 15 App Router app under `web/` — the Phase 10 target
stack — reusing every file under `src/` **completely unchanged** (no port, no
duplication). Same URL scheme and HTTP status codes as the zero-dep server, so
both are backed by the identical `LectureService`/gates. Flashcard/quiz
interactivity is genuine React (`useState` client components), not the
original inline `<script>`. CSP nonce via Next's own documented middleware
pattern; genuine `403`s from Server Components via `forbidden()`.

```bash
cd web
npm install
npm run dev      # http://localhost:3000 (dev mode)
npm run build && npm start   # production build
npm test         # builds + boots `next start` + drives the full journey over HTTP
```

Two disclosed, intentional differences from the zero-dep server's exact codes
(both are *more correct* HTTP semantics): unauthenticated GET-page redirects
are `307` (not `303` — 303 specifically means "convert POST to GET", which
doesn't apply to a GET-to-GET redirect); `POST .../publish` redirects with a
`?published=N` query notice instead of rendering the page inline at `200`.

The two presentation layers are independent and interchangeable — pick
whichever fits your deploy target; the zero-dep server remains the
dependency-free reference implementation.

## Roadmap
See Phase 12 in [`docs/DECISIONS.md`](docs/DECISIONS.md). Remaining, each
blocked on a resource unavailable in the build environment rather than
un-designed: live smoke-test of real providers (needs API keys), the
Postgres+pgvector `Repository` adapter (needs a running Postgres + an
async-port refactor), and building/verifying either `Dockerfile` (needs a
running Docker daemon).
