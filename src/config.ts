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

export const config = {
  providers: {
    transcription: str("TRANSCRIPTION_PROVIDER", "mock"),
    llm: str("LLM_PROVIDER", "mock"),
    embeddings: str("EMBEDDINGS_PROVIDER", "mock"),
  },
  llmModel: str("LLM_MODEL", "claude-sonnet-5"),
  keys: {
    assemblyai: str("ASSEMBLYAI_API_KEY", ""),
    deepgram: str("DEEPGRAM_API_KEY", ""),
    anthropic: str("ANTHROPIC_API_KEY", ""),
  },
  quality: {
    /** Segments below this are flagged as low-confidence (moat #1). */
    confidenceFlagThreshold: num("CONFIDENCE_FLAG_THRESHOLD", 0.75),
    /** Assets with more than this fraction flagged are auto-held (NFR-1). */
    assetAutoHoldFlagRatio: num("ASSET_AUTOHOLD_FLAG_RATIO", 0.15),
  },
} as const;

export type Config = typeof config;
