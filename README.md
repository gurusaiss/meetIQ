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

## Quick start

```bash
# no install needed to run — mock providers, Node 22+ strips the TS
npm run demo     # end-to-end run on the sample far-field lecture
npm test         # unit + integration tests (6 tests)

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
  demo.ts                  runnable end-to-end demo
sample-data/               far-field lecture fixture (has low-confidence segments)
test/                      node:test suite
```

## Roadmap
See Phase 12 in [`docs/DECISIONS.md`](docs/DECISIONS.md). Next: Increment 2 —
persistence (Prisma + Postgres/pgvector) and wiring the real providers.
