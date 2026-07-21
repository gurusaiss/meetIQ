# Architecture & Product Decisions (Compressed Phases 5–15)

> Working title: **Lecture Intelligence Platform (LIP)**
> Beachhead: higher-ed lecture intelligence. Moats: (1) far-field/confidence, (2) compliance-first, (3) output depth, (4) incumbent integration.
> This file records the *decisions taken*, with the alternative rejected and why. It is the contract for implementation.

---

## Phase 5 — Feature Prioritization (MVP cut)

MoSCoW, scored on impact × (1/effort), gated by the persona chain (Ted→Diane→Anika→Sam→Marcus).

**MUST (MVP / Increment scope):**
- Ingest audio/video (upload + at least one capture-incumbent import).
- Far-field-aware transcription + diarization with **per-segment confidence surfaced**.
- Topic segmentation → **Revision Notes** (grounded, timestamped).
- **Flashcards + Quiz/MCQ** generation.
- **Course RAG** — semantic search + grounded chat with citations.
- **Hallucination guard** — every generated claim traceable to a transcript span.
- **Faculty edit-and-approve gate** before student release.
- **Compliance spine** — consent record, tenant isolation, role-based access, audit log, retention.

**SHOULD (fast-follow):** LMS push (Canvas/Moodle), Anki/CSV export, translation, multi-language, accessibility transcript delivery.

**COULD (v2):** PPT engine, diagram engine, knowledge-graph viz, speaker-wise notes, corporate L&D.

**WON'T (v1):** online meeting bots, social/blog repurposing, podcasts, legal/medical verticals, real-time live captioning as a headline feature.

Rationale: depth over breadth (research showed every extra output has a funded competitor). Compliance + approval gate are non-negotiable because the persona chain breaks without them.

---

## Phase 6 — System Architecture

**Decision: Modular monolith (Next.js app) + one async worker service.**
Rejected microservices — unjustified at MVP; adds ops cost without scale need. Boundaries are drawn as modules so a service can be extracted later if a component needs independent scaling (the pipeline worker is the first candidate, already split out).

```
                    ┌────────────────────────────────────────┐
  Browser / LMS ──► │  Next.js app (UI + API + server actions) │
                    │  - auth, RBAC, tenant scoping            │
                    │  - upload, review/approve, search/chat   │
                    └───────────────┬──────────────────────────┘
                                    │ enqueue job
                                    ▼
                    ┌────────────────────────────────────────┐
   Redis (BullMQ) ◄─┤  Pipeline Worker (Node)                  │
                    │  transcribe → segment → notes →          │
                    │  flashcards/quiz → embed/index           │
                    │  (provider-abstracted; batch/async)      │
                    └───────────────┬──────────────────────────┘
        Postgres + pgvector ◄───────┤ persist assets + embeddings
        S3 / MinIO         ◄────────┘ media + generated files
```

Cross-cutting: OpenTelemetry traces, structured logs, audit log table, per-tenant data isolation.

---

## Phase 7 — Data Model (core entities)

Multi-tenant, `institution_id` on every row (moat #2 isolation).

- `Institution` (tenant; consent policy, data region, retention days)
- `User` (role: student|faculty|ta|admin; SSO subject)
- `Course` → `Enrollment` (user↔course, role in course)
- `Lecture` (course, media ref, status, consent record, capture source)
- `Transcript` (lecture; segments[] with start/end, speaker, text, confidence)
- `KnowledgeAsset` (lecture; type: notes|flashcards|quiz; status: draft|approved; content JSON; grounding refs)
- `Chunk` (lecture/course; text, embedding vector, source segment refs) — RAG index
- `AuditEvent` (actor, action, target, timestamp) — compliance
- `ConsentRecord` (lecture; policy, notice_shown, opt_outs)

---

## Phase 8 — API Design

REST-ish over Next.js route handlers + typed server actions. Key endpoints:

- `POST /api/lectures` (create + upload URL) · `GET /api/lectures/:id`
- `POST /api/lectures/:id/process` (enqueue pipeline)
- `GET /api/lectures/:id/assets` · `POST /api/assets/:id/approve` (faculty gate)
- `POST /api/courses/:id/search` (RAG) · `POST /api/courses/:id/chat`
- `GET /api/audit` (admin)
All tenant-scoped via session; RBAC middleware; Zod-validated inputs.

---

## Phase 9 — UX/UI

- LMS-native delivery (don't force students into a new app) — embed + deep links.
- Faculty review screen: notes/flashcards/quiz with **low-confidence spans highlighted**, inline edit, one-click approve.
- Student: revision notes with click-to-timestamp, flashcard/quiz runner, course search/chat with citations.
- Dark/light, WCAG AA, keyboard-first, real-time processing status.

---

## Phase 10 — Technology Selection

| Layer | Choice | Rejected alternative → why |
|---|---|---|
| Language | TypeScript everywhere | Python for AI → context-switch cost; TS AI SDKs now first-class |
| App | Next.js (App Router) | separate SPA+API → more glue for no benefit at MVP |
| Worker | Node + BullMQ + Redis | serverless funcs → long batch jobs + cost; queue fits batch model |
| DB | Postgres + **pgvector** | dedicated vector DB (Pinecone) → extra cost/ops; pgvector fine at MVP scale |
| ORM | Prisma | raw SQL → slower iteration |
| Media | S3 / MinIO (dev) | local disk → not multi-node |
| Auth | Auth.js → SAML/LMS LTI | roll-own → security risk |
| Transcription | provider-abstracted: AssemblyAI default, Deepgram/Whisper swappable | lock-in → moat needs to pick best far-field engine per deployment |
| LLM | provider-abstracted: Claude default | lock-in; also enables lightweight-model-first cost tiering |
| Embeddings | provider-abstracted | — |

**Cost optimization built into the abstraction:** cheap-model-first, hierarchical summarization, aggressive caching of intermediate outputs (transcript/segments reused across all asset types), batch (not streaming) transcription. COGS target ≤ $0.70/audio-hr.

---

## Phase 11 — AI Pipeline (see `src/pipeline`)

`transcribe → segment → [notes | flashcards/quiz] → embed/index`, with `confidence` and `grounding` cross-cutting. Every generated statement carries `sourceRefs` into transcript segments; ungrounded content is flagged, not shipped. Detailed in code.

---

## Phase 12 — Implementation Roadmap (increments)

- **Inc 1 (done):** value engine core — pipeline + provider abstraction, runnable with mocks, tested.
- **Inc 2 (done):** persistence + service layer. *Refinement:* used ports-and-adapters — a `Repository` interface with a zero-dep SQLite adapter (built-in `node:sqlite`) for local/dev; Postgres+pgvector becomes a drop-in prod adapter rather than a hard dev dependency (no Docker needed to run). Compliance gate + faculty approval gate + tenant isolation + audit are enforced in the service/repo, not just modeled. Real transcription/LLM providers remain stubs pending API keys.
- **Inc 3 (done):** web UI — dashboard/create, processing, **faculty review with highlighted low-confidence spans + approve gate**, student view (approved-only), course search with citations, audit page. *Refinement:* shipped as a zero-dep server-rendered app (Node `http`) reusing `LectureService` directly, so the flows are verifiable/runnable now; migrating this presentation layer to Next.js (Phase 10 target) is a mechanical follow-up. Verified end-to-end via HTTP + accessibility-tree inspection.
- **Inc 4 (done):** student surfaces — interactive flip-card flashcards + self-grading quiz runner (vanilla JS, no framework), plus exports (Markdown notes, **Anki-CSV flashcards**, Markdown quiz with answer key). Exporters are pure/tested; export routes serve approved assets only. 17 tests.
- **Inc 5 (done):** auth + RBAC + retention/erasure. Session/identity layer (dev login now; SAML/LTI adapter later, same `Session` shape). Every route role-gated (student can't create/approve/audit; admin-only audit + retention). Right-to-erasure delete removes lecture + all derived data; retention purges lectures past `retentionDays`. 24 tests; RBAC verified over HTTP.
- **Inc 6 (done):** integrations (moat #4) — capture-source import (Echo360/Panopto/Kaltura) + LMS push (Canvas/Moodle/Blackboard), ports-and-adapters with tested mock adapters and clearly-failing real stubs. Import is idempotent + seeds consent from the source; LMS push sends approved assets only; both audited. 30 tests; flows verified over HTTP.
- **Real providers (done, pending live verification):** AssemblyAI transcription (fetch, async batch + diarization) and Claude generation (official `@anthropic-ai/sdk`, structured outputs via `output_config.format`, model from `LLM_MODEL`, thinking disabled + effort-tiered for cost). Grounding enforced by requiring segment-id citations. SDK is dynamic-import-gated so the mock path stays dependency-free. Typecheck clean; not yet run against live services (no keys in-repo).
- **Inc 7 (done):** hardening/observability — structured JSON logging (pure, tested formatter), request logging with correlation ids (`x-request-id`), startup config validation (fail-fast with clear errors + required-key checks), `/healthz` + `/readyz` datastore probes, graceful shutdown (SIGTERM/SIGINT/SIGBREAK), and 500s no longer leak internal error detail to clients. 36 tests; runtime behaviors verified over HTTP.

---

## Phase 13 — Testing Strategy

- Unit: pipeline stages + providers (mock-driven, deterministic).
- Golden-set: a labeled far-field transcript → assert grounding + confidence behavior. **DONE** — `test/quality-gates.test.ts` drives the asset builder with controlled confidence profiles and pins the moat-#1 gates: clean audio stays draft, all-low-confidence auto-holds, the flag threshold and auto-hold ratio are honored at their boundaries, a hallucinated citation holds the asset even on clean audio, and no ungrounded content ever ships. 44 tests total.
- Integration: enqueue→process→persist.
- E2E: upload→approve→student search. **DONE** — `test/e2e.test.ts` boots the real server as a child process against a throwaway DB and drives login→create→process→approve→student→search→export→audit over HTTP, asserting the RBAC/approval/compliance gates.
- Quality gates (NFR-1): WER/DER thresholds auto-hold assets for review. **DONE** — `test/quality-gates.test.ts`.
- 50 tests total; CI runs typecheck + tests on every push/PR (Node 24).

**Security hardening (2026-07-19):** every response now carries a strict Content-Security-Policy (per-request nonce for the page's own inline `<style>`/`<script>`, no `unsafe-inline`, `object-src 'none'`, `frame-ancestors 'none'`), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and HSTS. `lectureId` (the one free-text field that reaches storage/exports) is now validated against a safe charset/length at the web boundary — rejects path-traversal-shaped input (e.g. `../etc/passwd`) with 400 instead of accepting it. Verified via curl (headers present, nonce matches the rendered page) and in `test/e2e.test.ts`.

**Increment 9 — session lifecycle + accessibility (2026-07-19):**
- Sessions now expire (8h TTL, `SessionStore` pruning on access) — previously they lived forever until server restart, a real gap for a compliance product. Login endpoint gets a sliding-window rate limiter (10/min per client) against brute-force/enumeration.
- Accessibility (NFR-6): all form labels now programmatically associated via `for`/`id` (login name/role, lecture id/capture source, search query — the latter via a visually-hidden label), a skip-to-content link, a `<main>` landmark, and visible `:focus-visible` outlines. Previously labels were adjacent siblings with no association — a real gap between the NFR-6 claim and the rendered markup.
- 54 tests total (4 new: session expiry, rate-limit unit + E2E, key-independent rate limiting). Verified live via curl (headers, label `for`/`id` pairs, skip link, main landmark).

---

## Phase 14 — Deployment

Containerized (Docker), cloud-agnostic. **DONE (app tier):** `Dockerfile` (no build step — runtime type-stripping; `/healthz` healthcheck), `.dockerignore`, and `docker-compose.yml` run the app self-contained on SQLite. The compose file scaffolds the future prod dependencies (Postgres+pgvector, Redis for the worker, MinIO) commented out until those adapters land. Prod target: managed Postgres, Redis, object storage; app + worker as separate deployables; region pinning per tenant (moat #2). (Docker image authored but not built in-repo — no running daemon here.)

---

## Phase 15 — Launch / GTM

- Land: one motivated department pilot (bottom-up via faculty champion), instrument usage→outcomes.
- Expand: department → college → institution; accessibility/compliance as the wedge that consumer tools can't cross.
- Pricing: institutional per-seat or per-audio-hour; healthy margin at ≤$0.70/hr COGS.
- Positioning: "the compliant AI layer on top of the lecture capture you already own."
