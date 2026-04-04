import fs from 'node:fs'
import path from 'node:path'
import 'dotenv/config'
import MDBReader from 'mdb-reader'
import { Types } from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { Product } from '../src/models/Product.js'
import { Sale } from '../src/models/Sale.js'
import { User } from '../src/models/User.js'

type Row = Record<string, unknown>

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined
  if (value instanceof Date) return value
  const s = String(value)
  // format like 201911220343
  if (/^\d{12}$/.test(s)) {
    const y = Number(s.slice(0, 4))
    const m = Number(s.slice(4, 6))
    const d = Number(s.slice(6, 8))
    const hh = Number(s.slice(8, 10))
    const mm = Number(s.slice(10, 12))
    return new Date(y, m - 1, d, hh, mm, 0)
  }
  const dt = new Date(s)
  return Number.isNaN(dt.getTime()) ? undefined : dt
}

function readJetRows(filePath: string, tableName: string): Row[] {
  const buffer = fs.readFileSync(filePath)
  const reader = new MDBReader(buffer)
  return reader.getTable(tableName).getData()
}

function paymentMethod(row: Row): string {
  const map: Record<string, number> = {
    cash: num(row['Cash']) ?? 0,
    card: (num(row['VisaMaster']) ?? 0) + (num(row['Amex']) ?? 0),
    eft: num(row['EFT']) ?? 0,
    cheque: num(row['Cheque']) ?? 0,
    voucher: num(row['Voucher']) ?? 0,
    wallet: num(row['WiWallet']) ?? 0,
    room: num(row['Room']) ?? 0,
  }
  let best = 'cash'
  let amount = -1
  for (const [k, v] of Object.entries(map)) {
    if (v > amount) {
      best = k
      amount = v
    }
  }
  return best
}

function receiptKey(receiptNo: number, terminal: number): string {
  return `${terminal}|${receiptNo}`
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const mongoUriFlagIdx = process.argv.indexOf('--mongo-uri')
  const mongoUri =
    mongoUriFlagIdx >= 0 ? (process.argv[mongoUriFlagIdx + 1] as string | undefined) : undefined
  const vectorBase =
    process.env.VECTOR_BACKUP_PATH ||
    '/home/nicorapelas/Workspace/electroPOS/VectorBackup/20260323_0320'

  const histPath = path.join(vectorBase, 'PosTransHist.dat')
  if (!fs.existsSync(histPath)) {
    throw new Error(`Expected PosTransHist.dat in ${vectorBase}`)
  }

  const paymentRows = readJetRows(histPath, 'Payment')
  const itemRows = readJetRows(histPath, 'Items')

  if (!dryRun) {
    if (mongoUri) {
      await connectDb(mongoUri)
    } else {
      const config = loadConfig()
      await connectDb(config.mongodbUri)
    }
  }

  const products = dryRun
    ? []
    : await Product.find({ 'legacy.source': 'vector' })
        .select('_id name sku legacy')
        .lean()
  const productByLegacy = new Map<string, { _id: Types.ObjectId; name: string; sku: string }>()
  for (const p of products as Array<{ _id: Types.ObjectId; name: string; sku: string; legacy?: { itemNo?: number; itemType?: number } }>) {
    if (!p.legacy?.itemNo && p.legacy?.itemNo !== 0) continue
    const itemNo = p.legacy?.itemNo
    const itemType = p.legacy?.itemType ?? 0
    if (itemNo === undefined) continue
    productByLegacy.set(`${itemNo}|${itemType}`, { _id: p._id, name: p.name, sku: p.sku })
  }

  const users = dryRun
    ? []
    : await User.find({ 'legacy.source': 'vector' })
        .select('_id legacy')
        .lean()
  const userByLegacy = new Map<number, Types.ObjectId>()
  for (const u of users as Array<{ _id: Types.ObjectId; legacy?: { userNo?: number } }>) {
    const userNo = u.legacy?.userNo
    if (userNo !== undefined) userByLegacy.set(userNo, u._id)
  }

  const itemsByReceipt = new Map<string, Row[]>()
  for (const row of itemRows) {
    const rcpt = num(row['Rcpt'])
    const terminal = num(row['Terminal'])
    if (rcpt === undefined || terminal === undefined) continue
    const k = receiptKey(rcpt, terminal)
    const list = itemsByReceipt.get(k) ?? []
    list.push(row)
    itemsByReceipt.set(k, list)
  }

  let considered = 0
  let migrated = 0
  let skipped = 0

  for (const pay of paymentRows) {
    const rcpt = num(pay['Rcpt'])
    const terminal = num(pay['Terminal'])
    const transType = num(pay['Transtype'])
    if (rcpt === undefined || terminal === undefined) {
      skipped += 1
      continue
    }
    // Keep only normal sales for now
    if (transType !== undefined && transType !== 1) {
      skipped += 1
      continue
    }

    const key = receiptKey(rcpt, terminal)
    const itemList = itemsByReceipt.get(key) ?? []
    if (itemList.length === 0) {
      skipped += 1
      continue
    }
    considered += 1

    const lines = itemList.map((it) => {
      const itemNo = num(it['No']) ?? 0
      const itemType = 0
      const qty = Math.max(1, Math.abs(num(it['Qty']) ?? 1))
      const amount = round2(Math.abs(num(it['Amount']) ?? 0))
      const unitPrice = qty > 0 ? round2(amount / qty) : amount
      const p = productByLegacy.get(`${itemNo}|${itemType}`)

      return {
        product: p?._id,
        sku: p?.sku ?? `VEC-${itemNo}-${itemType}`,
        legacyItemNo: itemNo,
        legacyItemType: itemType,
        name: p?.name ?? `Vector Item ${itemNo}`,
        quantity: qty,
        unitPrice,
        lineTotal: amount,
      }
    })

    const totalFromPay = round2(Math.abs(num(pay['Total']) ?? 0))
    const linesTotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
    const total = totalFromPay > 0 ? totalFromPay : linesTotal

    const userNo = num(pay['User'])
    const cashier = userNo !== undefined ? userByLegacy.get(userNo) : undefined
    const date = parseDate(pay['Date']) ?? parseDate(pay['ProcessedDate']) ?? new Date()

    if (!dryRun) {
      await Sale.updateOne(
        {
          'legacy.source': 'vector',
          'legacy.receiptNo': rcpt,
          'legacy.terminal': terminal,
        },
        {
          $set: {
            cashier: cashier ?? null,
            items: lines,
            total,
            paymentMethod: paymentMethod(pay),
            legacy: {
              source: 'vector',
              receiptNo: rcpt,
              terminal,
              transactionType: transType,
              userNo,
            },
            createdAt: date,
            updatedAt: date,
          },
        },
        { upsert: true },
      )
    }
    migrated += 1
  }

  console.log(`Payment rows total: ${paymentRows.length}`)
  console.log(`Items rows total: ${itemRows.length}`)
  console.log(`Considered sales receipts: ${considered}`)
  console.log(`Skipped receipts: ${skipped}`)
  console.log(`${dryRun ? 'Would migrate' : 'Migrated'} sales: ${migrated}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    try {
      if (Sale.db.readyState !== 0) {
        await Sale.db.close()
      }
    } catch {
      // ignore close errors
    }
  })

