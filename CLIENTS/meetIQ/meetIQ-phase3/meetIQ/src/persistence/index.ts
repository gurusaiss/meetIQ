/**
 * Repository factory — selects the adapter by config, so callers (the
 * zero-dep server, the Next.js app, tests) don't need to know which
 * datastore is behind the port. Mirrors the AI-provider selection pattern
 * in `src/providers/*` (mock-by-default, real adapters opt-in via env).
 */
import type { Repository } from "./repository.ts";
import { SqliteRepository } from "./sqlite.ts";
import { PostgresRepository } from "./postgres.ts";

export type { Repository } from "./repository.ts";

export interface RepositoryConfig {
  /** `sqlite` (default, zero-dep) or `postgres` (production target). */
  driver: string;
  /** SqliteRepository: file path (or `:memory:`). Ignored for postgres. */
  sqlitePath?: string;
  /** PostgresRepository: connection string. Required when driver=postgres. */
  databaseUrl?: string;
  vectorDim?: number;
}

export function createRepository(cfg: RepositoryConfig): Repository {
  switch (cfg.driver) {
    case "sqlite":
      return new SqliteRepository(cfg.sqlitePath);
    case "postgres": {
      if (!cfg.databaseUrl) {
        throw new Error("REPO_DRIVER=postgres requires DATABASE_URL to be set");
      }
      return new PostgresRepository({
        connectionString: cfg.databaseUrl,
        ...(cfg.vectorDim !== undefined ? { vectorDim: cfg.vectorDim } : {}),
      });
    }
    default:
      throw new Error(`Unknown REPO_DRIVER: ${cfg.driver}`);
  }
}
