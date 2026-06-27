/**
 * Seed POS preset buttons for watch pin spares (Vector POS layout).
 *
 * Category: Watch Spares — Sub-category: Pins
 *
 * Usage (from server/):
 *   npm run seed:watch-spares-pins-presets -- --dry-run
 *   npm run seed:watch-spares-pins-presets -- --confirm
 */
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { Product } from '../src/models/Product.js'
import { StoreSettings } from '../src/models/StoreSettings.js'
import { ensureStoreSettingsDoc } from '../src/controllers/storeSettings.controller.js'
import {
  mergeDefaultProductPresets,
  normalizeProductPresetsPayload,
  type PresetEntry,
  type ProductPresetsState,
} from '../src/utils/productPresets.js'

const PRESET_CATEGORY = 'Watch Spares'
const PRESET_SUB_CATEGORY = 'Pins'

/** Vector item numbers and button labels (left-to-right from legacy POS photo). */
const WATCH_PINS_PRESETS: Array<{ vectorItemNo: number; label: string; vectorName: string }> = [
  { vectorItemNo: 695, label: 'Knurled Pins', vectorName: 'KNURLED PINS' },
  { vectorItemNo: 4456, label: 'Screw Pins', vectorName: 'SCREW PINS' },
  { vectorItemNo: 694, label: 'Split Pins', vectorName: 'SPLIT PIN' },
  { vectorItemNo: 693, label: 'Spring Bar', vectorName: 'SPRING BAR' },
]

function skuCandidates(vectorItemNo: number): string[] {
  const base = String(vectorItemNo)
  return [base, `VEC-${base}-0`, `VEC-${base}-1`, `VEC-${base}-3`, `VEC-${base}-10`, `VEC-${base}-15`]
}

function mergePresets(
  existing: ProductPresetsState,
  newEntries: PresetEntry[],
): ProductPresetsState {
  const kept = existing.entries.filter(
    (e) => !(e.category === PRESET_CATEGORY && e.subCategory === PRESET_SUB_CATEGORY),
  )
  return normalizeProductPresetsPayload({
    entries: [...kept, ...newEntries],
    categories: existing.categories,
    subCategoriesByCategory: existing.subCategoriesByCategory,
  })
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const confirmed = process.argv.includes('--confirm')
  if (!dryRun && !confirmed) {
    console.error('Preview with --dry-run, then apply with --confirm')
    process.exit(1)
  }

  const config = loadConfig()
  await connectDb(config.mongodbUri)

  const itemNos = WATCH_PINS_PRESETS.map((p) => p.vectorItemNo)
  const allSkuCandidates = [...new Set(itemNos.flatMap(skuCandidates))]
  const products = await Product.find({
    $or: [{ sku: { $in: allSkuCandidates } }, { 'legacy.itemNo': { $in: itemNos } }],
  })
    .select({ name: 1, sku: 1, barcode: 1, price: 1, legacy: 1 })
    .lean()

  const bySku = new Map(products.map((p) => [p.sku, p]))
  const byLegacyItemNo = new Map<number, (typeof products)[number]>()
  for (const p of products) {
    const itemNo = p.legacy?.itemNo
    if (itemNo != null) byLegacyItemNo.set(itemNo, p)
  }

  const newEntries: PresetEntry[] = []
  const missing: typeof WATCH_PINS_PRESETS = []

  for (const spec of WATCH_PINS_PRESETS) {
    const product =
      byLegacyItemNo.get(spec.vectorItemNo) ??
      skuCandidates(spec.vectorItemNo)
        .map((sku) => bySku.get(sku))
        .find(Boolean)

    if (!product) {
      missing.push(spec)
      continue
    }

    newEntries.push({
      productId: String(product._id),
      category: PRESET_CATEGORY,
      subCategory: PRESET_SUB_CATEGORY,
      label: spec.label,
    })
  }

  console.log(`${dryRun ? 'Would create' : 'Creating'} ${newEntries.length}/${WATCH_PINS_PRESETS.length} presets`)
  console.log(`Target: ${PRESET_CATEGORY} → ${PRESET_SUB_CATEGORY}\n`)

  for (let i = 0; i < newEntries.length; i++) {
    const entry = newEntries[i]
    const product = products.find((p) => String(p._id) === entry.productId)
    console.log(
      `${String(i + 1).padStart(2)}. ${entry.label.padEnd(16)} ← ${product?.name ?? '?'} (sku ${product?.sku ?? '?'}, R${product?.price ?? '?'})`,
    )
  }

  if (missing.length) {
    console.error(`\nMissing ${missing.length} product(s):`)
    for (const m of missing) {
      console.error(`  item ${m.vectorItemNo}\t${m.label}\t(${m.vectorName})`)
    }
    process.exit(1)
  }

  const doc = await ensureStoreSettingsDoc()
  if (!doc) {
    console.error('Store settings unavailable')
    process.exit(1)
  }

  const current = mergeDefaultProductPresets(doc.productPresets)
  const replaced = current.entries.filter(
    (e) => e.category === PRESET_CATEGORY && e.subCategory === PRESET_SUB_CATEGORY,
  ).length
  const merged = mergePresets(current, newEntries)

  console.log(`\nExisting ${PRESET_CATEGORY}/${PRESET_SUB_CATEGORY} presets to replace: ${replaced}`)
  console.log(`Total presets after merge: ${merged.entries.length}`)

  if (dryRun) {
    console.log('\nRe-run with --confirm to apply.')
    process.exit(0)
  }

  await StoreSettings.findOneAndUpdate(
    { _id: 'default' },
    { $set: { productPresets: merged } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean()

  console.log('\nWatch spares (pins) presets saved. POS tills will pick them up on next preset sync.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
