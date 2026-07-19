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

### Using real providers
Copy `.env.example` → `.env` and set, e.g.:
```
TRANSCRIPTION_PROVIDER=assemblyai
ASSEMBLYAI_API_KEY=...
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```
(The real provider bodies land in Increment 2; the contracts are already stable.)

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
```

## Roadmap
See Phase 12 in [`docs/DECISIONS.md`](docs/DECISIONS.md). Next: Increment 2 —
persistence (Prisma + Postgres/pgvector) and wiring the real providers.
