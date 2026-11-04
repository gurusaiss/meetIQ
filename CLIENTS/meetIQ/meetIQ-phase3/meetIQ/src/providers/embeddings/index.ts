import { config } from "../../config.ts";
import { LocalEmbeddingsProvider } from "./local.ts";

export interface EmbeddingsProvider {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Deterministic mock embeddings: a hashed bag-of-words projected into a
 * fixed-dim unit vector. Not semantically great, but stable and dependency
 * -free, and good enough that lexically-overlapping queries rank first —
 * enough to exercise and test the RAG path end-to-end.
 */
export class MockEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = "mock";
  readonly dim = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of tokenize(text)) {
      const i = hash(tok) % this.dim;
      v[i] = (v[i] ?? 0) + 1;
    }
    return normalize(v);
  }
}

export function getEmbeddingsProvider(): EmbeddingsProvider {
  switch (config.providers.embeddings) {
    case "mock":
      return new MockEmbeddingsProvider();
    case "local":
      // The ONNX runtime + model are only actually loaded on the first
      // `.embed()` call (see local.ts's own lazy pipeline cache) — merely
      // constructing this class here doesn't pull in the heavy runtime
      // when running on mock/other providers.
      return new LocalEmbeddingsProvider();
    default:
      throw new Error(
        `Unknown or unimplemented EMBEDDINGS_PROVIDER: ${config.providers.embeddings}`,
      );
  }
}

// ── helpers ─────────────────────────────────────────────────────────
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot; // inputs are unit-normalized
}

function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  // Crude singularization so "collisions"/"collision", "lookups"/"lookup"
  // land in the same bucket. Not real stemming — just enough to make the
  // mock's lexical matching behave sanely for the demo/tests.
  return raw.map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}
