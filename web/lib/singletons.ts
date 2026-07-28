/**
 * Server-side singletons, reusing the exact business-logic modules from
 * `../../src` — the repository, service, session store, and rate limiter are
 * unchanged from the zero-dep server; only the HTTP-framing layer around
 * them (this Next.js app) is new.
 *
 * Construction + seeding are skipped entirely during `next build`'s "collect
 * page data" step (see the `NEXT_PHASE` guard below) and otherwise run once,
 * eagerly, at module load, cached on `globalThis`. Three reasons this matters
 * specifically under Next.js:
 *  - `next build` imports every route module across multiple worker
 *    PROCESSES purely to inspect its exports, never to serve a request. If
 *    module load touched the datastore, those processes would race to
 *    open/write the same SQLite file (or same Postgres schema-init) and the
 *    build itself would fail (`SQLITE_ERROR: database is locked` was a real
 *    failure this hit) — the phase guard avoids that entirely.
 *  - `globalThis` caching protects against Next's dev-mode module reloading
 *    spawning a second connection/session store on every edit.
 *  - Seeding (`seedInstitution`) is awaited via a **module-level top-level
 *    await**, not inside the getters — this keeps every getter synchronous
 *    (no call-site changes needed anywhere else in the app:
 *    `getRepo().getLecture()` still works), while guaranteeing seeding
 *    completes before the module finishes loading and any real request is
 *    served. This matters for a real async adapter (Postgres): without it, a
 *    request could race the seed insert and read a tenant that isn't there
 *    yet — a race SQLite's synchronous nature would have masked.
 */
import { mkdirSync } from "node:fs";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { validateConfig, config } from "../../src/config.ts";
import { logger } from "../../src/observability/logger.ts";
import { createRepository, type Repository } from "../../src/persistence/index.ts";
import { LectureService } from "../../src/services/lecture-service.ts";
import { SessionStore, RateLimiter } from "../../src/auth/session.ts";
import { MockLmsConnector } from "../../src/integrations/lms.ts";

export const INSTITUTION_ID = "inst-a";
export const COURSE_ID = "cs101";
export const COURSE_TITLE = "CS101 · Data Structures";
export const EXTERNAL_COURSE = "CS101-2026S";

interface Globals {
  __lipRepo?: Repository;
  __lipService?: LectureService;
  __lipSessions?: SessionStore;
  __lipLoginLimiter?: RateLimiter;
  __lipLms?: MockLmsConnector;
  __lipSeedPromise?: Promise<void>;
}
const g = globalThis as unknown as Globals;

function build(): void {
  if (g.__lipRepo) return;

  const configErrors = validateConfig();
  if (configErrors.length) {
    logger.error("Invalid configuration; refusing to start", { errors: configErrors });
    throw new Error(`Invalid configuration: ${configErrors.join("; ")}`);
  }

  const dataDir = process.env.DATA_DIR
    ? process.env.DATA_DIR.replace(/\/?$/, "/")
    : process.cwd() + "/../data/";
  if (config.repository.driver === "sqlite") mkdirSync(dataDir, { recursive: true });

  g.__lipRepo = createRepository({
    driver: config.repository.driver,
    sqlitePath: dataDir + "lip.sqlite",
    databaseUrl: config.repository.databaseUrl,
    vectorDim: config.repository.vectorDim,
  });
  logger.info("repository.selected", { driver: config.repository.driver });
  g.__lipService = new LectureService(g.__lipRepo);
  g.__lipSessions = new SessionStore();
  g.__lipLoginLimiter = new RateLimiter(10, 60_000);
  g.__lipLms = new MockLmsConnector();
}

async function seed(): Promise<void> {
  await g.__lipService!.seedInstitution(
    {
      id: INSTITUTION_ID,
      name: "State University",
      consentPolicy: "all_party",
      dataRegion: "us-east",
      retentionDays: 365,
    },
    { id: COURSE_ID, institutionId: INSTITUTION_ID, code: "CS101", title: COURSE_TITLE },
  );
}

// `next build`'s "collect page data" step imports every route module across
// several worker PROCESSES purely to introspect its exports — it never
// invokes a handler. Those processes each import this module concurrently;
// if we touched the datastore here, they'd race to open/write the same
// SQLite file (or same Postgres schema-init) and `next build` itself would
// fail (SQLITE_ERROR: database is locked was a real failure this hit).
// Real requests only ever happen under `next dev`/`next start`, where
// NEXT_PHASE is never phase-production-build, so this guard skips all I/O
// during build while still running it — via the top-level await below —
// before any actual route handler executes.
const isBuildPhase = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
if (!isBuildPhase) {
  build();
  if (!g.__lipSeedPromise) g.__lipSeedPromise = seed();
  // Top-level await: blocks this module (and anything importing it) from
  // finishing evaluation until seeding completes, exactly once per process.
  await g.__lipSeedPromise;
}

export function getRepo(): Repository {
  return g.__lipRepo!;
}
export function getService(): LectureService {
  return g.__lipService!;
}
export function getSessions(): SessionStore {
  return g.__lipSessions!;
}
export function getLoginLimiter(): RateLimiter {
  return g.__lipLoginLimiter!;
}
export function getLms(): MockLmsConnector {
  return g.__lipLms!;
}
