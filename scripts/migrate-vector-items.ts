import fs from 'node:fs'
import path from 'node:path'
import 'dotenv/config'
import MDBReader from 'mdb-reader'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { Product } from '../src/models/Product.js'

type Row = Record<string, unknown>

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const s = String(value).trim()
  return s ? s : undefined
}

function bool(value: unknown): boolean {
  return Boolean(value)
}

function makeSku(itemNo: number, itemType: number): string {
  return `VEC-${itemNo}-${itemType}`
}

function key(itemNo: number, itemType: number): string {
  return `${itemNo}|${itemType}`
}

function readJetRows(filePath: string, tableName: string): Row[] {
  const buffer = fs.readFileSync(filePath)
  const reader = new MDBReader(buffer)
  const table = reader.getTable(tableName)
  return table.getData()
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const embedded = args.has('--embedded-mongo') || args.has('--embedded') || args.has('--dev-local')
  const mongoUriFlagIdx = process.argv.indexOf('--mongo-uri')
  const mongoUri =
    mongoUriFlagIdx >= 0 ? (process.argv[mongoUriFlagIdx + 1] as string | undefined) : undefined
  const vectorBase =
    process.env.VECTOR_BACKUP_PATH ||
    '/home/nicorapelas/Workspace/electroPOS/VectorBackup/20260323_0320'

  const ramsetPath = path.join(vectorBase, 'Ramset.dat')
  const ramstockPath = path.join(vectorBase, 'RamStock.dat')
  if (!fs.existsSync(ramsetPath) || !fs.existsSync(ramstockPath)) {
    throw new Error(
      `Expected Ramset.dat and RamStock.dat in ${vectorBase}. Set VECTOR_BACKUP_PATH if needed.`,
    )
  }

  const [pluRows, deptRows, groupRows, stockRows] = [
    readJetRows(ramsetPath, 'PLU'),
    readJetRows(ramsetPath, 'Dept'),
    readJetRows(ramsetPath, 'Group'),
    readJetRows(ramstockPath, 'Stock'),
  ]

  const deptByCode = new Map<number, string>()
  for (const d of deptRows) {
    const code = num(d['Dept'])
    const name = str(d['Name'])
    if (code !== undefined && name) deptByCode.set(code, name)
  }

  const groupByCode = new Map<number, string>()
  for (const g of groupRows) {
    const code = num(g['Group'])
    const name = str(g['Name'])
    if (code !== undefined && name) groupByCode.set(code, name)
  }

  const stockByItem = new Map<string, Row>()
  for (const s of stockRows) {
    const itemNo = num(s['ItemNo'])
    const itemType = num(s['ItemType'])
    if (itemNo === undefined || itemType === undefined) continue
    stockByItem.set(key(itemNo, itemType), s)
  }

  let considered = 0
  let migrated = 0
  let skipped = 0

  let mongod: MongoMemoryServer | null = null
  try {
    if (!dryRun) {
      if (mongoUri) {
        console.log(`[migration] Using provided Mongo URI: ${mongoUri}`)
        await connectDb(mongoUri)
      } else if (embedded) {
        mongod = await MongoMemoryServer.create({ instance: { dbName: 'electropos' } })
        const uri = mongod.getUri('electropos')
        console.log(`[migration] Embedded MongoDB enabled: ${uri}`)
        await connectDb(uri)
      } else {
        const config = loadConfig()
        await connectDb(config.mongodbUri)
      }
    }

    for (const r of pluRows) {
      const itemNo = num(r['ItemNo'])
      const itemType = num(r['ItemType']) ?? 0
      const name = str(r['Name'])
      const enabled = bool(r['Enabled'])
      if (
        itemNo === undefined ||
        !name ||
        !enabled ||
        name.startsWith('*ITEMS PREVIOUSLY DELETED')
      ) {
        skipped += 1
        continue
      }
      considered += 1

      const deptCode = num(r['Dept'])
      const groupCode = num(r['Group'])
      const stock = stockByItem.get(key(itemNo, itemType))

      const doc = {
        name,
        longName: str(r['LongName']) ?? null,
        sku: makeSku(itemNo, itemType),
        barcode: str(r['Barcode']) ?? null,
        price: num(r['Price1']) ?? 0,
        stock: num(stock?.['SOH']) ?? 0,
        enabled,
        department: {
          code: deptCode,
          name: deptCode !== undefined ? deptByCode.get(deptCode) : undefined,
        },
        group: {
          code: groupCode,
          name: groupCode !== undefined ? groupByCode.get(groupCode) : undefined,
        },
        tax: {
          code: num(r['Tax']),
          altCode: num(r['AltTax']),
        },
        cost: {
          average: num(r['AvCost']),
          last: num(r['Last Cost']),
        },
        priceTiers: {
          price1: num(r['Price1']),
          price2: num(r['Price2']),
          price3: num(r['Price3']),
          price4: num(r['Price4']),
          price5: num(r['Price5']),
          price6: num(r['Price6']),
        },
        legacy: {
          source: 'vector' as const,
          itemNo,
          itemType,
          stockType: num(r['StockType']),
          stockLoc: num(r['StockLoc']),
          qtyMass: num(r['QtyMass']),
          textReference: str(r['TextReference']),
        },
      }

      if (!dryRun) {
        await Product.updateOne(
          {
            'legacy.source': 'vector',
            'legacy.itemNo': itemNo,
            'legacy.itemType': itemType,
          },
          { $set: doc },
          { upsert: true },
        )
      }
      migrated += 1
    }

    console.log(`Vector PLU rows total: ${pluRows.length}`)
    console.log(`Considered for migration: ${considered}`)
    console.log(`Skipped (disabled/deleted/invalid): ${skipped}`)
    console.log(`${dryRun ? 'Would migrate' : 'Migrated'} products: ${migrated}`)
    console.log(`Mode: ${dryRun ? 'dry-run' : embedded ? 'embedded-mongo' : 'external-mongo'}`)
  } finally {
    if (mongod) {
      await mongod.stop()
    }
  }

  // for dry-run we never connected, so there is no DB shutdown here
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
