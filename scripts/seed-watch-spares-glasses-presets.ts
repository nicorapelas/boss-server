/**
 * Seed POS preset buttons for watch glass spares (Vector POS layout).
 *
 * Category: Watch Spares — Sub-category: Glasses
 *
 * Also corrects WATCH GLASS 2MM (item 4166) price to R175 (Vector button price).
 *
 * Usage (from server/):
 *   npm run seed:watch-spares-glasses-presets -- --dry-run
 *   npm run seed:watch-spares-glasses-presets -- --confirm
 */
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { Product } from '../src/models/Product.js'
import { StoreSettings } from '../src/models/StoreSettings.js'
import { ensureStoreSettingsDoc } from '../src/controllers/storeSettings.controller.js'
import { bumpCatalogRevision } from '../src/services/catalogRevision.js'
import {
  mergeDefaultProductPresets,
  normalizeProductPresetsPayload,
  type PresetEntry,
  type ProductPresetsState,
} from '../src/utils/productPresets.js'

const PRESET_CATEGORY = 'Watch Spares'
const PRESET_SUB_CATEGORY = 'Glasses'

const GLASS_2MM_ITEM_NO = 4166
const GLASS_2MM_PRICE = 175

/** Vector item numbers and button labels (5+5+2 grid from legacy POS photo). */
const WATCH_GLASSES_PRESETS: Array<{ vectorItemNo: number; label: string; vectorName: string }> = [
  { vectorItemNo: 4171, label: 'Glass + DIAL', vectorName: 'WATCH GLASS+DIAL @200' },
  { vectorItemNo: 551, label: 'Glass 0.8mm', vectorName: 'WATCH GLASS 0.8MM @75' },
  { vectorItemNo: 737, label: 'Glass 1.0mm', vectorName: 'WATCH GLASS 1.0MM @100' },
  { vectorItemNo: 738, label: 'Glass 1.5mm', vectorName: 'WATCH GLASS 1.5MM @150' },
  { vectorItemNo: 4166, label: 'Glass 2mm', vectorName: 'WATCH GLASS 2MM @150' },
  { vectorItemNo: 4167, label: 'Glass 3mm', vectorName: 'WATCH GLASS 3MM @200' },
  { vectorItemNo: 4452, label: 'Glass Cut', vectorName: 'WATCH GLASS CUT @150' },
  { vectorItemNo: 4168, label: 'Glass DOME', vectorName: 'WATCH GLASS DOME @150' },
  { vectorItemNo: 4169, label: 'Glass D-SHAPE', vectorName: 'WATCH GLASS D-SHAPE @150' },
  { vectorItemNo: 4170, label: 'Glass W-P', vectorName: 'WATCH GLASS W-P @150' },
  { vectorItemNo: 6994, label: 'POLISH GLASS', vectorName: 'WATCH GLASS POLISH' },
  { vectorItemNo: 4930, label: 'WATCH GLASS', vectorName: 'WATCH GLASS @180' },
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

async function fixGlass2mmPrice(dryRun: boolean): Promise<void> {
  const product = await Product.findOne({
    $or: [{ 'legacy.itemNo': GLASS_2MM_ITEM_NO }, { sku: { $in: skuCandidates(GLASS_2MM_ITEM_NO) } }],
  })
    .select({ name: 1, sku: 1, price: 1 })
    .lean()

  if (!product) {
    console.error(`Glass 2mm product (item ${GLASS_2MM_ITEM_NO}) not found — cannot fix price`)
    process.exit(1)
  }

  if (product.price === GLASS_2MM_PRICE) {
    console.log(`Glass 2mm price already R${GLASS_2MM_PRICE} (${product.name}, sku ${product.sku})`)
    return
  }

  console.log(
    `${dryRun ? 'Would update' : 'Updating'} Glass 2mm price: R${product.price} → R${GLASS_2MM_PRICE} (${product.name}, sku ${product.sku})`,
  )

  if (!dryRun) {
    await Product.updateOne({ _id: product._id }, { $set: { price: GLASS_2MM_PRICE } })
    const rev = await bumpCatalogRevision()
    console.log(`Catalog revision → ${rev}`)
  }
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

  await fixGlass2mmPrice(dryRun)

  const itemNos = WATCH_GLASSES_PRESETS.map((p) => p.vectorItemNo)
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
  const missing: typeof WATCH_GLASSES_PRESETS = []

  for (const spec of WATCH_GLASSES_PRESETS) {
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

  console.log(`\n${dryRun ? 'Would create' : 'Creating'} ${newEntries.length}/${WATCH_GLASSES_PRESETS.length} presets`)
  console.log(`Target: ${PRESET_CATEGORY} → ${PRESET_SUB_CATEGORY}\n`)

  for (let i = 0; i < newEntries.length; i++) {
    const entry = newEntries[i]
    const spec = WATCH_GLASSES_PRESETS[i]
    const product = products.find((p) => String(p._id) === entry.productId)
    const price =
      spec.vectorItemNo === GLASS_2MM_ITEM_NO && product?.price !== GLASS_2MM_PRICE
        ? GLASS_2MM_PRICE
        : product?.price
    console.log(
      `${String(i + 1).padStart(2)}. ${entry.label.padEnd(16)} ← ${product?.name ?? '?'} (sku ${product?.sku ?? '?'}, R${price ?? '?'})`,
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

  console.log('\nWatch spares (glasses) presets saved. POS tills will pick them up on next preset sync.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
