/**
 * Local text embedder. Uses a deterministic hash-based embedding when ONNX
 * model is unavailable so offline tests still pass.
 */
export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export class LocalEmbedder implements Embedder {
  constructor(private readonly dimension = 384) {}

  async embed(text: string): Promise<Float32Array> {
    return hashEmbed(text, this.dimension);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * Simple bag-of-chars hashing to fixed-dim unit vector (offline stand-in for ONNX).
 */
export function hashEmbed(text: string, dimension: number): Float32Array {
  const vec = new Float32Array(dimension);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    const idx = code % dimension;
    vec[idx] += 1;
    vec[(idx * 31 + code) % dimension] += 0.5;
  }
  let norm = 0;
  for (let i = 0; i < dimension; i++) norm += (vec[i] ?? 0) ** 2;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dimension; i++) {
    vec[i] = (vec[i] ?? 0) / norm;
  }
  return vec;
}
