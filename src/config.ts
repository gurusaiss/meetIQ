/** Central config, read once from env with safe defaults (mock everywhere). */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const config = {
  providers: {
    transcription: str("TRANSCRIPTION_PROVIDER", "mock"),
    llm: str("LLM_PROVIDER", "mock"),
    embeddings: str("EMBEDDINGS_PROVIDER", "mock"),
  },
  /** Empty means "use the selected provider's own default model". */
  llmModel: str("LLM_MODEL", ""),
  keys: {
    assemblyai: str("ASSEMBLYAI_API_KEY", ""),
    deepgram: str("DEEPGRAM_API_KEY", ""),
    anthropic: str("ANTHROPIC_API_KEY", ""),
    groq: str("GROQ_API_KEY", ""),
  },
  quality: {
    /** Segments below this are flagged as low-confidence (moat #1). */
    confidenceFlagThreshold: num("CONFIDENCE_FLAG_THRESHOLD", 0.75),
    /** Assets with more than this fraction flagged are auto-held (NFR-1). */
    assetAutoHoldFlagRatio: num("ASSET_AUTOHOLD_FLAG_RATIO", 0.15),
  },
  repository: {
    /** `sqlite` (default, zero-dep) or `postgres` (prod target, needs a real DB). */
    driver: str("REPO_DRIVER", "sqlite"),
    databaseUrl: str("DATABASE_URL", ""),
    vectorDim: num("EMBEDDING_VECTOR_DIM", 256),
  },
  security: {
    /**
     * `X-Forwarded-For` is client-suppliable and only trustworthy behind a
     * reverse proxy that overwrites/strips it before forwarding. Default
     * false because the default deploy target (`docker-compose.yml`) exposes
     * the app directly with no proxy in front — trusting it there would let
     * any client bypass the login rate limiter by varying the header.
     */
    trustProxy: bool("TRUST_PROXY", false),
    /**
     * Whether the session cookie gets the `Secure` attribute (browser will
     * only ever send it over HTTPS). Defaults to on in production and off
     * in dev, since local dev serves plain HTTP and a `Secure` cookie the
     * browser refuses to send there would silently break every login.
     * Override with COOKIE_SECURE=0/1 for deployments that don't set
     * NODE_ENV=production (e.g. behind a TLS-terminating proxy in staging).
     */
    secureCookies: bool("COOKIE_SECURE", process.env.NODE_ENV === "production"),
  },
} as const;

export type Config = typeof config;

const VALID = {
  transcription: ["mock", "assemblyai", "deepgram", "groq"],
  llm: ["mock", "anthropic", "groq"],
  embeddings: ["mock", "local"],
  repository: ["sqlite", "postgres"],
};

/**
 * Validate configuration. Returns a list of human-readable problems (empty =
 * OK). Called at startup to fail fast with a clear message rather than
 * blowing up mid-request with an obscure error.
 */
export function validateConfig(c: Config = config): string[] {
  const errors: string[] = [];
  if (!VALID.transcription.includes(c.providers.transcription))
    errors.push(`TRANSCRIPTION_PROVIDER "${c.providers.transcription}" is not one of ${VALID.transcription.join(", ")}`);
  if (!VALID.llm.includes(c.providers.llm))
    errors.push(`LLM_PROVIDER "${c.providers.llm}" is not one of ${VALID.llm.join(", ")}`);
  if (!VALID.embeddings.includes(c.providers.embeddings))
    errors.push(`EMBEDDINGS_PROVIDER "${c.providers.embeddings}" is not one of ${VALID.embeddings.join(", ")}`);
  if (!VALID.repository.includes(c.repository.driver))
    errors.push(`REPO_DRIVER "${c.repository.driver}" is not one of ${VALID.repository.join(", ")}`);

  const { confidenceFlagThreshold: t, assetAutoHoldFlagRatio: r } = c.quality;
  if (!(t >= 0 && t <= 1)) errors.push(`CONFIDENCE_FLAG_THRESHOLD must be in [0,1], got ${t}`);
  if (!(r >= 0 && r <= 1)) errors.push(`ASSET_AUTOHOLD_FLAG_RATIO must be in [0,1], got ${r}`);

  // Selected real providers/adapters must have their key/connection present.
  if (c.providers.transcription === "assemblyai" && !c.keys.assemblyai)
    errors.push("TRANSCRIPTION_PROVIDER=assemblyai but ASSEMBLYAI_API_KEY is empty");
  if (c.providers.transcription === "groq" && !c.keys.groq)
    errors.push("TRANSCRIPTION_PROVIDER=groq but GROQ_API_KEY is empty");
  if (c.providers.llm === "anthropic" && !c.keys.anthropic)
    errors.push("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty");
  if (c.providers.llm === "groq" && !c.keys.groq)
    errors.push("LLM_PROVIDER=groq but GROQ_API_KEY is empty");
  if (c.repository.driver === "postgres" && !c.repository.databaseUrl)
    errors.push("REPO_DRIVER=postgres but DATABASE_URL is empty");

  return errors;
}
