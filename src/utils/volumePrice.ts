import type { IProduct } from '../models/Product.js'

export type VolumeTierInput = { minQty: number; maxQty: number | null; unitPrice: number }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Line **total quantity** (all units on this line) picks exactly one price bucket.
 * The chosen tier’s unit price applies to **every** unit — not progressive per-ordinal.
 * Tiers with higher `minQty` are checked first so e.g. 100 lands in 100+ not 10–99.
 */
export function unitPriceForLineQuantity(
  quantity: number,
  basePrice: number,
  volumeTieringEnabled: boolean,
  volumeTiers: VolumeTierInput[] | null | undefined,
): number {
  const bp = round2(basePrice)
  if (!volumeTieringEnabled || !volumeTiers?.length || quantity < 1) {
    return bp
  }
  const sorted = [...volumeTiers].sort((a, b) => b.minQty - a.minQty)
  for (const t of sorted) {
    if (quantity < t.minQty) continue
    if (t.maxQty != null && quantity > t.maxQty) continue
    return round2(t.unitPrice)
  }
  return bp
}

/**
 * One segment per line: same `unitPrice` for all `quantity` (flat / stair-step volume pricing).
 */
export function expandVolumeLineSegments(
  quantity: number,
  basePrice: number,
  volumeTieringEnabled: boolean,
  volumeTiers: VolumeTierInput[] | null | undefined,
): Array<{ quantity: number; unitPrice: number; lineTotal: number; listUnitPrice?: number }> {
  const bp = round2(basePrice)
  if (quantity < 1) {
    return [{ quantity: 0, unitPrice: bp, lineTotal: 0, listUnitPrice: undefined }]
  }
  if (!volumeTieringEnabled || !volumeTiers?.length) {
    const lineTotal = round2(quantity * bp)
    return [{ quantity, unitPrice: bp, lineTotal, listUnitPrice: undefined }]
  }
  const u = unitPriceForLineQuantity(quantity, bp, true, volumeTiers)
  const lineTotal = round2(quantity * u)
  // listUnitPrice is for cashier price overrides only — not volume tier (see shifts Z report).
  return [{ quantity, unitPrice: u, lineTotal, listUnitPrice: undefined }]
}

export function validateVolumeTiers(
  basePrice: number,
  volumeTieringEnabled: boolean,
  raw: unknown,
): { ok: true; tiers: VolumeTierInput[] } | { ok: false; message: string } {
  if (!volumeTieringEnabled) {
    return { ok: true, tiers: [] }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: 'Add at least one volume tier, or turn volume tiering off' }
  }
  const parsed: VolumeTierInput[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      return { ok: false, message: 'Invalid tier row' }
    }
    const o = row as Record<string, unknown>
    const minQty = Math.floor(Number(o.minQty))
    const maxRaw = o.maxQty
    const maxQty =
      maxRaw === null || maxRaw === undefined || (typeof maxRaw === 'string' && maxRaw.trim() === '')
        ? null
        : Math.floor(Number(maxRaw))
    const unitPrice = round2(Number(o.unitPrice))
    if (!Number.isFinite(minQty) || minQty < 1) {
      return { ok: false, message: 'Each tier needs minQty as a whole number ≥ 1' }
    }
    if (maxQty != null && (!Number.isFinite(maxQty) || maxQty < minQty)) {
      return { ok: false, message: 'Tier max must be empty (and up) or ≥ minQty' }
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { ok: false, message: 'Each tier needs a valid unit price' }
    }
    parsed.push({ minQty, maxQty, unitPrice })
  }
  const sorted = [...parsed].sort((a, b) => a.minQty - b.minQty)
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0) {
      const prev = sorted[i - 1]
      if (prev.maxQty == null) {
        return { ok: false, message: 'Only the last tier can be "and up" (leave max empty)' }
      }
      if (sorted[i].minQty !== prev.maxQty + 1) {
        return { ok: false, message: 'Tiers must be contiguous (next min = previous max + 1)' }
      }
    }
  }
  if (sorted[sorted.length - 1].maxQty != null) {
    return { ok: false, message: 'The last tier must be open-ended: leave "to" empty for "and up"' }
  }
  if (sorted[0].minQty < 1) {
    return { ok: false, message: 'First tier minQty invalid' }
  }
  return { ok: true, tiers: sorted }
}

export function productHasVolumeTiering(
  p: Pick<IProduct, 'volumeTieringEnabled' | 'volumeTiers'>,
): p is IProduct & { volumeTieringEnabled: true; volumeTiers: VolumeTierInput[] } {
  return Boolean(
    p.volumeTieringEnabled && Array.isArray(p.volumeTiers) && p.volumeTiers.length > 0,
  )
}

/** True when unitPrice matches the configured volume tier for this quantity (not a cashier override). */
export function isVolumeTierUnitPrice(
  product: Pick<IProduct, 'price' | 'volumeTieringEnabled' | 'volumeTiers'>,
  quantity: number,
  unitPrice: number,
): boolean {
  if (!productHasVolumeTiering(product)) return false
  const expected = unitPriceForLineQuantity(
    quantity,
    round2(product.price ?? 0),
    true,
    product.volumeTiers,
  )
  return Math.abs(expected - round2(unitPrice)) <= 0.02
}

export function expandForProduct(
  p: Pick<IProduct, 'price' | 'name'> & { volumeTieringEnabled?: boolean; volumeTiers?: VolumeTierInput[] | null },
  quantity: number,
): Array<{ quantity: number; unitPrice: number; lineTotal: number; listUnitPrice?: number }> {
  const base = round2(p.price ?? 0)
  if (!p.volumeTieringEnabled || !p.volumeTiers?.length) {
    return expandVolumeLineSegments(quantity, base, false, [])
  }
  return expandVolumeLineSegments(quantity, base, true, p.volumeTiers)
}
