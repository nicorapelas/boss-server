/** Face descriptor model used by POS / Back Office (@vladmandic/face-api 128-D). */
export const FACE_MODEL_ID = 'face-api-128-v1'
export const FACE_EMBEDDING_DIM = 128
/** Max Euclidean distance to accept a match (lower = stricter). */
export const FACE_MATCH_MAX_DISTANCE = 0.55
/** Best match must beat second-best by at least this distance. */
export const FACE_MATCH_MIN_MARGIN = 0.08

export function validateFaceEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== FACE_EMBEDDING_DIM) return null
  const out: number[] = []
  for (const v of raw) {
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    out.push(n)
  }
  return out
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!
    sum += d * d
  }
  return Math.sqrt(sum)
}

export function averageEmbeddings(samples: number[][]): number[] {
  if (samples.length === 0) throw new Error('NO_SAMPLES')
  const dim = samples[0]!.length
  const out = new Array<number>(dim).fill(0)
  for (const s of samples) {
    if (s.length !== dim) throw new Error('DIM_MISMATCH')
    for (let i = 0; i < dim; i++) out[i]! += s[i]!
  }
  for (let i = 0; i < dim; i++) out[i]! /= samples.length
  return out
}

export type FaceMatchCandidate = { userId: string; embedding: number[] }

export function findBestFaceMatch(
  probe: number[],
  candidates: FaceMatchCandidate[],
): { userId: string; distance: number } | null {
  if (probe.length !== FACE_EMBEDDING_DIM || candidates.length === 0) return null

  let best: { userId: string; distance: number } | null = null
  let secondBest = Number.POSITIVE_INFINITY

  for (const c of candidates) {
    if (c.embedding.length !== FACE_EMBEDDING_DIM) continue
    const d = euclideanDistance(probe, c.embedding)
    if (!best || d < best.distance) {
      secondBest = best?.distance ?? Number.POSITIVE_INFINITY
      best = { userId: c.userId, distance: d }
    } else if (d < secondBest) {
      secondBest = d
    }
  }

  if (!best || best.distance > FACE_MATCH_MAX_DISTANCE) return null
  if (candidates.length > 1 && secondBest - best.distance < FACE_MATCH_MIN_MARGIN) return null
  return best
}
