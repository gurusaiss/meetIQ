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

- **Inc 1 (this):** value engine core — pipeline + provider abstraction, runnable with mocks, tested. ← *building now*
- **Inc 2:** persistence (Prisma/Postgres/pgvector) + real providers wired.
- **Inc 3:** Next.js app — upload, processing status, faculty review/approve.
- **Inc 4:** student surfaces — notes viewer, flashcard/quiz runner, search/chat.
- **Inc 5:** compliance spine — consent, RBAC, audit, retention; auth/SSO.
- **Inc 6:** integrations — LMS push, capture-incumbent import; exports.
- **Inc 7:** hardening — observability, load/scale, security review, SOC 2 path.

---

## Phase 13 — Testing Strategy

- Unit: pipeline stages + providers (mock-driven, deterministic).
- Golden-set: a labeled far-field transcript → assert grounding + confidence behavior.
- Integration: enqueue→process→persist.
- E2E: upload→approve→student search.
- Quality gates (NFR-1): WER/DER thresholds auto-hold assets for review.

---

## Phase 14 — Deployment

Containerized (Docker), cloud-agnostic. `docker-compose` for local (Postgres+pgvector, Redis, MinIO). Prod: managed Postgres, Redis, object storage; app + worker as separate deployables; region pinning per tenant (moat #2).

---

## Phase 15 — Launch / GTM

- Land: one motivated department pilot (bottom-up via faculty champion), instrument usage→outcomes.
- Expand: department → college → institution; accessibility/compliance as the wedge that consumer tools can't cross.
- Pricing: institutional per-seat or per-audio-hour; healthy margin at ≤$0.70/hr COGS.
- Positioning: "the compliant AI layer on top of the lecture capture you already own."
