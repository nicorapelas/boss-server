import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { Product } from '../src/models/Product.js'

type Candidate = {
  id: string
  currentSku: string
  targetSku: string
  baseSku: string
  itemType: number
}

function parseMongoUriArg(): string | undefined {
  const idx = process.argv.indexOf('--mongo-uri')
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  return undefined
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const mongoUri = parseMongoUriArg()

  if (mongoUri) {
    await connectDb(mongoUri)
  } else {
    const config = loadConfig()
    await connectDb(config.mongodbUri)
  }

  const all = await Product.find().select('_id sku').lean()
  const bySku = new Map<string, string>()
  for (const p of all) {
    bySku.set(p.sku, String(p._id))
  }

  const vecPattern = /^VEC-(\d+)-\d+$/i
  const candidates: Candidate[] = []
  for (const p of all) {
    const m = p.sku.match(vecPattern)
    if (!m) continue
    const baseSku = m[1]
    const itemType = Number(p.sku.split('-')[2] || 0)
    const targetSku = itemType === 0 ? baseSku : `${baseSku}-${itemType}`
    if (targetSku === p.sku) continue
    candidates.push({
      id: String(p._id),
      currentSku: p.sku,
      targetSku,
      baseSku,
      itemType,
    })
  }

  const conflicts: Array<{ id: string; currentSku: string; targetSku: string; reason: string }> = []
  const reservedTargets = new Set<string>()
  const safe: Candidate[] = []

  for (const c of candidates) {
    const owner = bySku.get(c.targetSku)
    if (owner && owner !== c.id) {
      // Fallback if a zero-type item collides with existing target:
      // use "<base>-<type>" so every vector SKU can still be normalized safely.
      const fallback = `${c.baseSku}-${c.itemType}`
      const fallbackOwner = bySku.get(fallback)
      if (!fallbackOwner || fallbackOwner === c.id) {
        c.targetSku = fallback
      } else {
        conflicts.push({
          ...c,
          reason: `target SKU already exists on product ${owner}; fallback ${fallback} also exists`,
        })
        continue
      }
    }
    if (reservedTargets.has(c.targetSku)) {
      conflicts.push({
        ...c,
        reason: 'target SKU duplicated within normalization batch',
      })
      continue
    }
    reservedTargets.add(c.targetSku)
    safe.push(c)
  }

  if (!dryRun && safe.length > 0) {
    await Product.bulkWrite(
      safe.map((c) => ({
        updateOne: {
          filter: { _id: c.id },
          update: { $set: { sku: c.targetSku } },
        },
      })),
      { ordered: false },
    )
  }

  console.log(`Products total: ${all.length}`)
  console.log(`SKU candidates matching VEC pattern: ${candidates.length}`)
  console.log(`${dryRun ? 'Would update' : 'Updated'} SKUs: ${safe.length}`)
  console.log(`Conflicts skipped: ${conflicts.length}`)
  if (conflicts.length > 0) {
    console.log('First 20 conflicts:')
    for (const c of conflicts.slice(0, 20)) {
      console.log(`- ${c.currentSku} -> ${c.targetSku} (${c.reason})`)
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    try {
      if (Product.db.readyState !== 0) {
        await Product.db.close()
      }
    } catch {
      // ignore close errors
    }
  })

