/**
 * Set trackInventory=false on labour / service charge catalog lines.
 *
 * Usage (from server/):
 *   npm run untrack:labour -- --dry-run
 *   npm run untrack:labour -- --confirm
 */
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { Product } from '../src/models/Product.js'
import { bumpCatalogRevision } from '../src/services/catalogRevision.js'

/** Name patterns for non-stocked labour / service PLUs (Jacobs Cycles Vector catalog). */
export function isLabourOrServiceName(name: string): boolean {
  const n = name.trim()
  if (!n) return false
  const upper = n.toUpperCase()
  if (upper.startsWith('LABOUR') || /\bLABOUR\b/.test(upper)) return true
  if (upper.startsWith('SERVICE') || /\bSERVICE\b/.test(upper)) return true
  if (/\bLABOR\b/.test(upper)) return true
  return false
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const confirmed = process.argv.includes('--confirm')
  if (!dryRun && !confirmed) {
    console.error('Preview changes with --dry-run, then apply with --confirm')
    process.exit(1)
  }

  const config = loadConfig()
  await connectDb(config.mongodbUri)

  const products = await Product.find({ enabled: { $ne: false } })
    .select({ name: 1, sku: 1, trackInventory: 1 })
    .lean()

  const targets = products.filter(
    (p) => isLabourOrServiceName(p.name) && p.trackInventory !== false,
  )

  console.log(`${dryRun ? 'Would update' : 'Updating'} ${targets.length} product(s)`)
  for (const p of targets.slice(0, 30)) {
    console.log(`  ${p.sku}\t${p.name}`)
  }
  if (targets.length > 30) console.log(`  … and ${targets.length - 30} more`)

  if (dryRun) {
    console.log('\nRe-run with --confirm to apply.')
    process.exit(0)
  }

  if (targets.length === 0) {
    console.log('Nothing to update.')
    process.exit(0)
  }

  const ids = targets.map((p) => p._id)
  const result = await Product.updateMany({ _id: { $in: ids } }, { $set: { trackInventory: false } })
  const catalogRevision = await bumpCatalogRevision()

  console.log(`Updated ${result.modifiedCount} product(s). Catalog revision → ${catalogRevision}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
