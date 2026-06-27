/**
 * Seed POS preset buttons for bicycle repair labour (Vector POS layout).
 *
 * Category: Labour — Sub-category: Bicycles
 *
 * Usage (from server/):
 *   npm run seed:bicycle-labour-presets -- --dry-run
 *   npm run seed:bicycle-labour-presets -- --confirm
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
const PRESET_SUB_CATEGORY = 'Bicycles'

/** Vector item numbers and button labels (grid order from legacy POS). */
const BICYCLE_LABOUR_PRESETS: Array<{ vectorItemNo: number; label: string; vectorName: string }> = [
  { vectorItemNo: 3220, label: '@ R10.00', vectorName: 'LABOUR @ R10' },
  { vectorItemNo: 4426, label: '@ R20.00', vectorName: 'LABOUR @ R20' },
  { vectorItemNo: 7903, label: '@ R30.00', vectorName: 'LABOUR @ R30' },
  { vectorItemNo: 788, label: 'Adjust Brakes', vectorName: 'LABOUR ADJUST BRAKES' },
  { vectorItemNo: 3144, label: 'Adjust Gears', vectorName: 'LABOUR ADJUST GEARS' },
  { vectorItemNo: 3145, label: 'BB Cups/Axle', vectorName: 'LABOUR BB CUPS/AXLE' },
  { vectorItemNo: 4175, label: 'Chain Wheel Only', vectorName: 'LABOUR CHAIN-WHEEL' },
  { vectorItemNo: 787, label: 'Chain', vectorName: 'LABOUR CHAIN' },
  { vectorItemNo: 4805, label: 'Clean Bike', vectorName: 'CLEAN BIKE' },
  { vectorItemNo: 3148, label: 'Cog', vectorName: 'LABOUR COG' },
  { vectorItemNo: 3237, label: 'Fork', vectorName: 'FORK LABOUR' },
  { vectorItemNo: 3142, label: 'Front Hub', vectorName: 'HUB FRONT REPLACE' },
  { vectorItemNo: 6909, label: 'H/BRAKE+FLU', vectorName: 'LABOUR H/BRAKE+FLUID' },
  { vectorItemNo: 3146, label: 'Head Set/Bearings', vectorName: 'LABOUR HEAD SET/BEARINGS' },
  { vectorItemNo: 4238, label: 'MOTOR Tyre/Tube', vectorName: 'LABOUR MOTOR TYRE/TUBE' },
  { vectorItemNo: 3159, label: 'New Bike Assembly', vectorName: 'NEW BICYCLE ASSEMBLY' },
  { vectorItemNo: 6054, label: 'Puncture MOTO', vectorName: 'LABOUR PUNCTURE MOTO' },
  { vectorItemNo: 3998, label: 'Puncture tubeless + slime', vectorName: 'LABOUR PUNCTURE TL+SLIME' },
  { vectorItemNo: 3143, label: 'Puncture', vectorName: 'LABOUR PUNCTURE' },
  { vectorItemNo: 3141, label: 'Rear Hub', vectorName: 'HUB REAR REPLACE' },
  { vectorItemNo: 6910, label: 'Service @195', vectorName: 'LABOUR SERVICE @195' },
  { vectorItemNo: 4447, label: 'Service R125', vectorName: 'SERVICE @125' },
  { vectorItemNo: 3161, label: 'Service R75', vectorName: 'SERVICE @75' },
  { vectorItemNo: 3140, label: 'Spoke @ R2.00', vectorName: 'SPOKE X1 @2.00' },
  { vectorItemNo: 3701, label: 'Spoke @ R3', vectorName: 'SPOKE X1 @3' },
  { vectorItemNo: 3865, label: 'T-LESS VALVE/SLIME', vectorName: 'LABOUR T-LESS VALVE/SLIME' },
  { vectorItemNo: 1336, label: 'Tubeless Conversion', vectorName: 'LABOUR TUBELESSCONVERSION' },
  { vectorItemNo: 3256, label: 'Tubeless Rim-Tape Applied', vectorName: 'RIM TAPE TUBELESS APPLIED' },
  { vectorItemNo: 7684, label: 'TYRE FLAT-PK', vectorName: 'LABOUR TYRE FLAT PACK' },
  { vectorItemNo: 3150, label: 'Tyre/Tube', vectorName: 'LABOUR TYRE/TUBE' },
  { vectorItemNo: 3147, label: 'Wheel Axle/Bearings', vectorName: 'LABOUR WHEEL AXLE/BEARING' },
  { vectorItemNo: 5231, label: 'Wheel BP Axle/Bearings', vectorName: 'LABOUR BP AXLE/BEARINGS' },
  { vectorItemNo: 6893, label: 'Wheel Cones', vectorName: 'LABOUR CONES' },
  { vectorItemNo: 3139, label: 'Wheel truing', vectorName: 'LABOUR WHEEL TRUING' },
]

function skuCandidates(vectorItemNo: number): string[] {
  const base = String(vectorItemNo)
  return [base, `VEC-${base}-0`, `VEC-${base}-1`, `VEC-${base}-3`, `VEC-${base}-10`]
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

  const itemNos = BICYCLE_LABOUR_PRESETS.map((p) => p.vectorItemNo)
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
  const missing: typeof BICYCLE_LABOUR_PRESETS = []

  for (const spec of BICYCLE_LABOUR_PRESETS) {
    let product =
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

  console.log(`${dryRun ? 'Would create' : 'Creating'} ${newEntries.length}/${BICYCLE_LABOUR_PRESETS.length} presets`)
  console.log(`Target: ${PRESET_CATEGORY} → ${PRESET_SUB_CATEGORY}\n`)

  for (let i = 0; i < newEntries.length; i++) {
    const spec = BICYCLE_LABOUR_PRESETS[i]
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

  console.log('\nBicycle labour presets saved. POS tills will pick them up on next preset sync.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
