export const PRESET_ENTRY_MAX = 200

export type PresetEntry = {
  productId: string
  category: string
  subCategory: string
  label: string
}

export type ProductPresetsState = {
  entries: PresetEntry[]
  categories: string[]
  subCategoriesByCategory: Record<string, string[]>
}

export const EMPTY_PRODUCT_PRESETS: ProductPresetsState = {
  entries: [],
  categories: [],
  subCategoriesByCategory: {},
}

function parseEntry(o: Record<string, unknown>): PresetEntry | null {
  const productId = typeof o.productId === 'string' ? o.productId.trim() : ''
  const category = typeof o.category === 'string' ? o.category.trim() : ''
  const subCategory = typeof o.subCategory === 'string' ? o.subCategory.trim() : ''
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  if (productId && category && subCategory && label) {
    return { productId, category, subCategory, label }
  }
  return null
}

function normalizeSubMap(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = k.trim()
      if (!key || !Array.isArray(v)) continue
      const subs = [...new Set(v.filter((s): s is string => typeof s === 'string').map((s) => s.trim()))].filter(
        Boolean,
      )
      if (subs.length) out[key] = [...subs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    }
  }
  return out
}

/** Validates and normalizes client payload; drops invalid entries, caps at PRESET_ENTRY_MAX. */
export function normalizeProductPresetsPayload(body: unknown): ProductPresetsState {
  if (body == null || typeof body !== 'object') {
    return { ...EMPTY_PRODUCT_PRESETS }
  }
  const b = body as Record<string, unknown>
  const entriesRaw = b.entries
  const entries: PresetEntry[] = []
  if (Array.isArray(entriesRaw)) {
    for (const x of entriesRaw) {
      if (x == null || typeof x !== 'object') continue
      const e = parseEntry(x as Record<string, unknown>)
      if (e) entries.push(e)
      if (entries.length >= PRESET_ENTRY_MAX) break
    }
  }
  let categories: string[] = []
  if (Array.isArray(b.categories) && b.categories.every((c) => typeof c === 'string')) {
    categories = [...new Set((b.categories as string[]).map((c) => c.trim()).filter(Boolean))].sort((a, x) =>
      a.localeCompare(x, undefined, { sensitivity: 'base' }),
    )
  }
  const subCategoriesByCategory = normalizeSubMap(b.subCategoriesByCategory)
  const derivedCats = new Set(categories)
  for (const e of entries) {
    derivedCats.add(e.category)
    const subs = new Set(subCategoriesByCategory[e.category] ?? [])
    subs.add(e.subCategory)
    subCategoriesByCategory[e.category] = [...subs].sort((a, x) =>
      a.localeCompare(x, undefined, { sensitivity: 'base' }),
    )
  }
  categories = [...derivedCats].sort((a, x) => a.localeCompare(x, undefined, { sensitivity: 'base' }))
  return { entries, categories, subCategoriesByCategory }
}

export function mergeDefaultProductPresets(
  raw: ProductPresetsState | null | undefined,
): ProductPresetsState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PRODUCT_PRESETS }
  return normalizeProductPresetsPayload(raw)
}
