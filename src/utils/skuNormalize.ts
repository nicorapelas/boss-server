/** Strip leading zeros from digit-only keys so 008632 and 8632 match. */
export function numericSkuKey(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw.trim().toLowerCase()
  return digits.replace(/^0+/, '') || '0'
}

/** Normalize stored SKU (Vector VEC-*, padded numerics, type suffix). */
export function canonicalizeSku(sku: string): string {
  const trimmed = sku.trim()
  if (!trimmed) return trimmed

  const vec = /^VEC-(\d+)-(\d+)$/i.exec(trimmed)
  if (vec) {
    const base = numericSkuKey(vec[1])
    const itemType = Number(vec[2])
    return itemType === 0 ? base : `${base}-${itemType}`
  }

  const dash = trimmed.indexOf('-')
  if (dash > 0) {
    const left = trimmed.slice(0, dash)
    const right = trimmed.slice(dash + 1)
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      return `${numericSkuKey(left)}-${right}`
    }
  }

  if (/^\d+$/.test(trimmed)) {
    return numericSkuKey(trimmed)
  }

  return trimmed
}
