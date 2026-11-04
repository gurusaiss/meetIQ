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
- **Inc 11 (done, 2026-07-22):** Postgres + pgvector adapter — the `Repository` port gained a second, production-grade adapter (`src/persistence/postgres.ts`) alongside `SqliteRepository`, selected via `REPO_DRIVER`/`DATABASE_URL` through a `createRepository` factory (`src/persistence/index.ts`); `chunks.embedding` is a real `vector(n)` column (dimension fixed at first `CREATE TABLE`, configurable via `EMBEDDING_VECTOR_DIM`), not inert JSON. *Refinement:* the `Repository` interface had to become fully `async` (`Promise`-returning) to honestly represent a network-backed adapter — `SqliteRepository`'s synchronous-under-the-hood nature had been masking this. That refactor surfaced and fixed two real, pre-existing correctness bugs invisible under SQLite: (1) un-awaited service calls inside `try/catch` in `web/app/lectures/[id]/delete/route.ts` and `web/app/admin/retention/route.ts` meant thrown `AuthorizationError`s became unhandled rejections instead of being caught; (2) `if (!lecture)` checks against an un-awaited `Promise` in the review/student pages and the publish route were always false, so genuinely-missing lectures never 404'd. Both fixed by adding the missing `await`s. Separately, exercising the adapter over real HTTP surfaced a genuine **tenant-isolation bug in the pipeline itself** (not Postgres-specific, just newly-observable): chunk ids were generated as `chunk-${topicId}` (e.g. `chunk-topic-0`), unique only *within* one lecture's processing run — a second lecture (any tenant) producing the same topic count collided on that primary key, and `ON CONFLICT DO UPDATE` silently overwrote the row's `text`/`embedding` while leaving `institution_id`/`lecture_id` pointed at the *original* owner. Fixed in `src/pipeline/rag.ts` by scoping chunk ids per lecture (`${lectureId}:chunk:${topicId}`), matching the convention already used for asset ids. Verified against a live `pgvector/pgvector:pg16` Docker container: `test/postgres-repository.test.ts` (5 tests: healthcheck, full CRUD incl. float round-trip through `vector(256)`, tenant isolation, right-to-erasure, full `LectureService` lifecycle parity with the mock pipeline) plus a full HTTP-driven login→create→process→approve→student→search journey against the real adapter, confirming search returns real citable hits (not the silently-corrupted empty result the id-collision bug produced). `docker-compose.yml` gained an opt-in `--profile postgres` stack (`postgres` service + `app-postgres`) wiring `REPO_DRIVER=postgres` end-to-end.
- **Inc 12 (done, 2026-07-28): production-readiness / security hardening pass**, prompted by a direct ask to get the app live-ready. Fixed 5 real issues found by exercising the app rather than just reading it: (1) **`next build` was silently broken** — the top-level-await seeding `web/lib/singletons.ts` gained in Inc 11 made module import eager again, so `next build`'s multi-worker page-data-collection step raced several processes onto the same SQLite file and failed with `SQLITE_ERROR: database is locked`; fixed with a `NEXT_PHASE !== phase-production-build` guard so build-time imports stay side-effect-free. (2) `SessionStore`/`RateLimiter` (`src/auth/session.ts`) leaked memory — an abandoned session or a client hit once and never again kept its map entry forever since cleanup only ran lazily on access to that same key; added a periodic sweep. (3) The Next.js login route keyed its rate limiter off the client-spoofable `X-Forwarded-For` header with no trust boundary, letting anyone bypass it by varying the header — the zero-dep server already used the real socket address instead; added `config.security.trustProxy` (`TRUST_PROXY`, default off, matching the proxy-less `docker-compose.yml` deploy target). (4) Creating a lecture with an id that already exists (a real double-submit scenario) threw a raw adapter-specific SQL error instead of a clean one; added `ConflictError` in `LectureService.createLecture`, caught in both presentation layers for a friendly 409. (5) Session cookies were missing the `Secure` attribute in both presentation layers, letting them travel over plain HTTP even when TLS is available; added `config.security.secureCookies` (defaults to on when `NODE_ENV=production`, overridable via `COOKIE_SECURE`, off in dev since local dev serves plain HTTP). Also ran `npm audit` on both packages: root had 0 vulnerabilities; `web/` had 4 high-severity advisories (Next.js SSRF/DoS/cache-confusion issues plus transitive postcss/sharp CVEs) — fixed by upgrading Next 15→16 (`npm audit fix --force`), reverified with a full rebuild + the complete e2e suite (7/7 pass) to confirm the major bump broke nothing. All fixes carry regression tests in both root and web suites (root: 58 pass + 5 skipped without `DATABASE_URL`; web: 7 pass, includes a real `next build`).

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

**Increment 10 — Next.js migration (2026-07-19):** the presentation layer originally built as a zero-dep Node server (Phase 3–9) is now ALSO available as a real Next.js 15 App Router app under `web/`, fulfilling the Phase 10 target stack.
- **100% business-logic reuse.** Every file under `src/` (pipeline, providers, persistence, services, auth, integrations, export, observability, config) is imported completely unchanged — no port, no duplication. `web/lib/singletons.ts` wires the same `SqliteRepository`/`LectureService`/`SessionStore`/`RateLimiter` with **lazy** initialization — a real bug was found and fixed here: eager module-scope initialization raced across Next's multi-worker build-time page-data collection and threw `SQLITE_BUSY`.
- **Same URL scheme, same HTTP status codes** (303/403/400/409/404) as the zero-dep server, via Next Route Handlers for every mutation — this let the same E2E test shape be reused (`web/test/e2e.test.ts` mirrors `test/e2e.test.ts`), both asserting against the identical `LectureService`.
- **Genuine React, not string-template ports.** Flashcard/quiz interactivity is real client components (`useState`), not the old inline `<script>`. Verified via rendered markup + hydration-bundle presence — the browser-automation tool in this environment has a pre-existing viewport bug (noted, not silently worked around), so verification relies on HTTP/markup evidence (exact status codes, exact cookies, exact content, JS chunks present and linked) rather than a driven click.
- **CSP nonce via Next's own documented middleware pattern** (`web/middleware.ts`): script-src gets a real per-request nonce + `strict-dynamic`; style-src uses `unsafe-inline` (Next's own official CSP example does the same, since dev-mode Fast Refresh injects inline styles).
- **Genuine 403s from Server Components** via Next's `forbidden()` API (`experimental.authInterrupts`), not a 200 response whose body merely says "forbidden".
- Fixed a **real, shared bug** found during this work: `MockTranscriptionProvider` resolved its fixture path via `fileURLToPath(new URL(..., import.meta.url))`, which breaks under webpack bundling (a cross-realm `URL` instance fails `instanceof` checks deep in `readFile`). Fixed by importing the fixture as a JSON module instead — benefits the original zero-dep server too (same file, no duplication), verified by re-running the full 54-test root suite before touching the Next app further.
- **Two disclosed, intentional differences** from the zero-dep server (both more-correct HTTP semantics, not regressions): unauthenticated GET-page redirects are 307 (Next's default for GET-to-GET) instead of 303 (which specifically means "convert POST to GET"); `POST /lectures/[id]/publish` redirects with a `?published=N` query notice instead of rendering the page inline at 200 (proper POST-redirect-GET).
- Verified: `next build` succeeds, `next start` boots against a throwaway DB, and the full login→create→process→approve→student→search→export→audit journey passes over real HTTP — both via manual curl and an automated `web/test/e2e.test.ts` (6 tests). Root suite unaffected (54/54 still pass).
- **Not verified:** `web/Dockerfile` (authored, not built — no running Docker daemon in this environment, same blocker as the root Dockerfile).
- CI gained a second job, `test-web`, running the Next app's typecheck + build + E2E suite.

---

## Phase 14 — Deployment

Containerized (Docker), cloud-agnostic. **DONE (app tier):** `Dockerfile` (no build step — runtime type-stripping; `/healthz` healthcheck), `.dockerignore`, and `docker-compose.yml` run the app self-contained on SQLite by default, or against real Postgres+pgvector via `docker compose --profile postgres up` (Inc 11). Redis (worker queue) and MinIO (object storage) remain scaffolded/commented until those adapters land. Prod target: managed Postgres, Redis, object storage; app + worker as separate deployables; region pinning per tenant (moat #2).

---

## Phase 15 — Launch / GTM

- Land: one motivated department pilot (bottom-up via faculty champion), instrument usage→outcomes.
- Expand: department → college → institution; accessibility/compliance as the wedge that consumer tools can't cross.
- Pricing: institutional per-seat or per-audio-hour; healthy margin at ≤$0.70/hr COGS.
- Positioning: "the compliant AI layer on top of the lecture capture you already own."
