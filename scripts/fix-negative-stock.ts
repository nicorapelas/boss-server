/**
 * Set product stock to 0 where it is currently negative.
 *
 * Usage (from server/):
 *   npm run fix:negative-stock -- --dry-run
 *   npm run fix:negative-stock -- --confirm
 */
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { Product } from '../src/models/Product.js'
import { bumpCatalogRevision } from '../src/services/catalogRevision.js'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const confirmed = process.argv.includes('--confirm')
  if (!dryRun && !confirmed) {
    console.error('Preview with --dry-run, then apply with --confirm')
    process.exit(1)
  }

  const config = loadConfig()
  await connectDb(config.mongodbUri)

  const filter = { stock: { $lt: 0 } }
  const before = await Product.countDocuments(filter)

  if (before === 0) {
    console.log('No products with negative stock.')
    process.exit(0)
  }

  const samples = await Product.find(filter)
    .sort({ stock: 1, sku: 1 })
    .limit(25)
    .select({ name: 1, sku: 1, stock: 1, trackInventory: 1 })
    .lean()

  console.log(`${dryRun ? 'Would fix' : 'Fixing'} ${before} product(s) with negative stock → 0\n`)
  console.log('Sample (worst first, up to 25):')
  for (const p of samples) {
    const track = p.trackInventory === false ? 'no-track' : 'tracked'
    console.log(`  ${String(p.stock).padStart(6)} → 0\t${p.sku}\t${p.name}\t(${track})`)
  }
  if (before > samples.length) {
    console.log(`  … and ${before - samples.length} more`)
  }

  if (dryRun) {
    console.log('\nRe-run with --confirm to apply.')
    process.exit(0)
  }

  const result = await Product.updateMany(filter, { $set: { stock: 0 } })
  const after = await Product.countDocuments(filter)
  const rev = await bumpCatalogRevision()

  console.log(`\nMatched: ${result.matchedCount}`)
  console.log(`Modified: ${result.modifiedCount}`)
  console.log(`Remaining negative: ${after}`)
  console.log(`Catalog revision → ${rev}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
