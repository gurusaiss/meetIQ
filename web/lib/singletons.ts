/**
 * Server-side singletons, reusing the exact business-logic modules from
 * `../../src` — the repository, service, session store, and rate limiter are
 * unchanged from the zero-dep server; only the HTTP-framing layer around
 * them (this Next.js app) is new.
 *
 * Initialization is LAZY (first-call, not module-load) and cached on
 * `globalThis`. Two reasons this matters specifically under Next.js:
 *  - Next's `next build` "collect page data" step imports every route module
 *    across multiple worker processes to inspect its exports. A module-level
 *    side effect (opening the SQLite file) then races across workers and
 *    throws "database is locked" — a real failure this project hit.
 *  - `globalThis` caching also protects against Next's dev-mode module
 *    reloading spawning a second connection/session store on every edit.
 */
import { mkdirSync } from "node:fs";
import { validateConfig } from "../../src/config.ts";
import { logger } from "../../src/observability/logger.ts";
import { SqliteRepository } from "../../src/persistence/sqlite.ts";
import { LectureService } from "../../src/services/lecture-service.ts";
import { SessionStore, RateLimiter } from "../../src/auth/session.ts";
import { MockLmsConnector } from "../../src/integrations/lms.ts";

export const INSTITUTION_ID = "inst-a";
export const COURSE_ID = "cs101";
export const COURSE_TITLE = "CS101 · Data Structures";
export const EXTERNAL_COURSE = "CS101-2026S";

interface Globals {
  __lipRepo?: SqliteRepository;
  __lipService?: LectureService;
  __lipSessions?: SessionStore;
  __lipLoginLimiter?: RateLimiter;
  __lipLms?: MockLmsConnector;
  __lipSeeded?: boolean;
}
const g = globalThis as unknown as Globals;

function ensureBuilt(): void {
  if (g.__lipRepo) return;

  const configErrors = validateConfig();
  if (configErrors.length) {
    logger.error("Invalid configuration; refusing to start", { errors: configErrors });
    throw new Error(`Invalid configuration: ${configErrors.join("; ")}`);
  }

  const dataDir = process.env.DATA_DIR
    ? process.env.DATA_DIR.replace(/\/?$/, "/")
    : process.cwd() + "/../data/";
  mkdirSync(dataDir, { recursive: true });

  g.__lipRepo = new SqliteRepository(dataDir + "lip.sqlite");
  g.__lipService = new LectureService(g.__lipRepo);
  g.__lipSessions = new SessionStore();
  g.__lipLoginLimiter = new RateLimiter(10, 60_000);
  g.__lipLms = new MockLmsConnector();

  if (!g.__lipSeeded) {
    g.__lipService.seedInstitution(
      {
        id: INSTITUTION_ID,
        name: "State University",
        consentPolicy: "all_party",
        dataRegion: "us-east",
        retentionDays: 365,
      },
      { id: COURSE_ID, institutionId: INSTITUTION_ID, code: "CS101", title: COURSE_TITLE },
    );
    g.__lipSeeded = true;
  }
}

export function getRepo(): SqliteRepository {
  ensureBuilt();
  return g.__lipRepo!;
}
export function getService(): LectureService {
  ensureBuilt();
  return g.__lipService!;
}
export function getSessions(): SessionStore {
  ensureBuilt();
  return g.__lipSessions!;
}
export function getLoginLimiter(): RateLimiter {
  ensureBuilt();
  return g.__lipLoginLimiter!;
}
export function getLms(): MockLmsConnector {
  ensureBuilt();
  return g.__lipLms!;
}
