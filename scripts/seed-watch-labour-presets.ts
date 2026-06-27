/**
 * Seed POS preset buttons for watch repair labour (Vector POS layout).
 *
 * Category: Labour — Sub-category: Watches
 *
 * Usage (from server/):
 *   npm run seed:watch-labour-presets -- --dry-run
 *   npm run seed:watch-labour-presets -- --confirm
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

const PRESET_CATEGORY = 'Labour'
const PRESET_SUB_CATEGORY = 'Watches'

/** Vector item numbers and button labels (grid order from legacy POS). */
const WATCH_LABOUR_PRESETS: Array<{ vectorItemNo: number; label: string; vectorName: string }> = [
  { vectorItemNo: 3601, label: 'Auto Service @300', vectorName: 'AUTO SERVICE' },
  { vectorItemNo: 4470, label: 'Clock Service Wind-up', vectorName: 'CLOCK SERVICE WIND-UP' },
  { vectorItemNo: 3231, label: 'Fit Movement @40', vectorName: 'FIT MOVEMENT @40' },
  { vectorItemNo: 3894, label: 'Labour @ R15', vectorName: 'LABOUR@15' },
  { vectorItemNo: 3413, label: 'Labour @25', vectorName: 'WATCH LABOUR @25' },
  { vectorItemNo: 4205, label: 'Labour @50', vectorName: 'WATCH LABOUR @50' },
  { vectorItemNo: 4835, label: 'Labour@100', vectorName: 'LABOUR@100' },
  { vectorItemNo: 736, label: 'Labour@30', vectorName: 'LABOUR@30' },
  { vectorItemNo: 4834, label: 'Labour@40', vectorName: 'LABOUR@40' },
  { vectorItemNo: 4145, label: 'Labour@75', vectorName: 'LABOUR@75' },
  { vectorItemNo: 4120, label: 'LID SEEL', vectorName: 'WATCH LID SEEL' },
  { vectorItemNo: 191, label: 'Quartz Service @300', vectorName: 'WATCH SERVICE QUARTZ @300' },
  { vectorItemNo: 4813, label: 'SERVICE @500', vectorName: 'WATCH SERVICE QUARTZ @500' },
  { vectorItemNo: 702, label: 'Strap Adjustment', vectorName: 'STRAP ADJUSTMENT' },
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

  const itemNos = WATCH_LABOUR_PRESETS.map((p) => p.vectorItemNo)
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
  const missing: typeof WATCH_LABOUR_PRESETS = []

  for (const spec of WATCH_LABOUR_PRESETS) {
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

  console.log(`${dryRun ? 'Would create' : 'Creating'} ${newEntries.length}/${WATCH_LABOUR_PRESETS.length} presets`)
  console.log(`Target: ${PRESET_CATEGORY} → ${PRESET_SUB_CATEGORY}\n`)

  for (let i = 0; i < newEntries.length; i++) {
    const entry = newEntries[i]
    const product = products.find((p) => String(p._id) === entry.productId)
    console.log(
      `${String(i + 1).padStart(2)}. ${entry.label.padEnd(28)} ← ${product?.name ?? '?'} (sku ${product?.sku ?? '?'}, R${product?.price ?? '?'})`,
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

  console.log('\nWatch labour presets saved. POS tills will pick them up on next preset sync.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
