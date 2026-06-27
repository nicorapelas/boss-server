import fs from 'node:fs'
import path from 'node:path'
import 'dotenv/config'
import MDBReader from 'mdb-reader'
import { Types } from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { LayBy } from '../src/models/LayBy.js'
import { Product } from '../src/models/Product.js'
import { StoreSettings } from '../src/models/StoreSettings.js'
import { User } from '../src/models/User.js'
import { vatAmountFromInclusive } from '../src/controllers/layby.controller.js'

type VectorLaybyCust = {
  LayByNo: number
  CustName?: string | null
  Ref?: string | null
  TelNo?: string | null
  Notes?: string | null
  Completed?: boolean
}

type VectorLaybyTrans = {
  LayByNo: number
  Terminal?: number
  ItemNo: number
  Description?: string | null
  PriceInc?: number
  QTY?: number
  TotalInc?: number
}

type VectorLaybyTrack = {
  LayByNo: number
  Date: string | number
  TransType: number
  CurBal?: number
  NewBal?: number
  TransVal?: number
  Rcpt?: number
  SeqNo?: number
  Terminal?: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

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

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 9) return digits
  return ''
}

function vectorLayByNumber(no: number): string {
  return `L${String(no).padStart(6, '0')}`
}

function parseTrackDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value
  const s = String(value ?? '').trim()
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

function readLaybyTables(laybysPath: string) {
  const reader = new MDBReader(fs.readFileSync(laybysPath))
  return {
    cust: reader.getTable('LaybyCust').getData() as VectorLaybyCust[],
    trans: reader.getTable('LaybyTrans').getData() as VectorLaybyTrans[],
    track: reader.getTable('LaybyTrack').getData() as VectorLaybyTrack[],
  }
}

function resolveVectorPath(): string {
  const flagIdx = process.argv.indexOf('--vector-rpos')
  if (flagIdx >= 0) {
    const p = process.argv[flagIdx + 1]
    if (p) return path.resolve(p)
  }
  return path.resolve(
    process.env.VECTOR_RPOS_PATH ||
      process.env.VECTOR_LAYBY_PATH ||
      '/home/nicorapelas/Workspace/electroPOS/tmp/rpos25',
  )
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const activeOnly = !args.has('--all')
  const replace = args.has('--replace')

  const vectorRpos = resolveVectorPath()
  const laybysPath = path.join(vectorRpos, 'PosLaybys.dat')
  if (!fs.existsSync(laybysPath)) {
    throw new Error(`Expected PosLaybys.dat in ${vectorRpos}`)
  }

  const { cust, trans, track } = readLaybyTables(laybysPath)
  if (cust.length === 0) {
    throw new Error('PosLaybys.dat has no LaybyCust rows — use Till 3 rpos25 folder')
  }

  const mongoUriFlagIdx = process.argv.indexOf('--mongo-uri')
  const mongoUri =
    mongoUriFlagIdx >= 0 ? (process.argv[mongoUriFlagIdx + 1] as string | undefined) : undefined

  if (mongoUri) await connectDb(mongoUri)
  else await connectDb(loadConfig().mongodbUri)

  const settings =
    (await StoreSettings.findById('default').lean()) ?? {
      vatRate: 0.15,
      defaultDepositPercent: 30,
      defaultExpiryMonths: 3,
      nextLayBySeq: 1,
    }

  const vatRate = settings.vatRate ?? 0.15
  const defaultExpiryMonths = settings.defaultExpiryMonths ?? 3

  const products = await Product.find({})
    .select({ _id: 1, name: 1, sku: 1, legacy: 1 })
    .lean()

  const productByLegacy = new Map<string, { _id: Types.ObjectId; name: string; sku: string }>()
  for (const p of products as Array<{
    _id: Types.ObjectId
    name: string
    sku: string
    legacy?: { itemNo?: number; itemType?: number }
  }>) {
    const itemNo = p.legacy?.itemNo
    const itemType = p.legacy?.itemType ?? 0
    if (itemNo !== undefined) {
      productByLegacy.set(`${itemNo}|${itemType}`, { _id: p._id, name: p.name, sku: p.sku })
    }
    if (p.sku?.startsWith('VEC-')) {
      const m = /^VEC-(\d+)-(\d+)$/.exec(p.sku)
      if (m) productByLegacy.set(`${m[1]}|${m[2]}`, { _id: p._id, name: p.name, sku: p.sku })
    }
  }

  const createdBy =
    (await User.findOne({ active: { $ne: false } }).sort({ createdAt: 1 }).select('_id').lean()) as
      | { _id: Types.ObjectId }
      | null

  if (!createdBy) {
    throw new Error('No active user found for createdBy / payment attribution')
  }
  const createdById = createdBy._id

  const linesByLayby = new Map<number, VectorLaybyTrans[]>()
  for (const row of trans) {
    const list = linesByLayby.get(row.LayByNo) ?? []
    list.push(row)
    linesByLayby.set(row.LayByNo, list)
  }

  const trackByLayby = new Map<number, VectorLaybyTrack[]>()
  for (const row of track) {
    const list = trackByLayby.get(row.LayByNo) ?? []
    list.push(row)
    trackByLayby.set(row.LayByNo, list)
  }

  if (!dryRun && replace) {
    const deleted = await LayBy.deleteMany({ layByNumber: { $regex: /^L\d{6}$/ } })
    console.log(`Removed ${deleted.deletedCount} prior Vector lay-bys (L######)`)
  }

  let considered = 0
  let migrated = 0
  let skipped = 0
  const skipReasons: Record<string, number> = {}
  const samples: string[] = []

  function skip(reason: string) {
    skipped += 1
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1
  }

  for (const c of cust) {
    const layByNo = c.LayByNo
    const layByNumber = vectorLayByNumber(layByNo)
    const history = (trackByLayby.get(layByNo) ?? []).sort(
      (a, b) => (a.SeqNo ?? 0) - (b.SeqNo ?? 0),
    )
    if (history.length === 0) {
      skip('no_track_history')
      continue
    }

    const last = history[history.length - 1]!
    const balance = round2(Math.max(0, num(last.NewBal) ?? 0))
    const isActive = balance > 0.02
    if (activeOnly && !isActive) {
      skip('not_active')
      continue
    }

    considered += 1

    const rawLines = linesByLayby.get(layByNo) ?? []
    if (rawLines.length === 0) {
      skip('no_line_items')
      continue
    }

    const lines: Array<{
      productId: Types.ObjectId
      name: string
      sku: string
      quantity: number
      unitPrice: number
      lineTotal: number
      listUnitPrice?: number
    }> = []

    let missingProducts = 0
    for (const row of rawLines) {
      const itemNo = num(row.ItemNo) ?? 0
      const itemType = 0
      const qty = Math.max(1, Math.round(num(row.QTY) ?? 1))
      const lineTotal = round2(num(row.TotalInc) ?? (num(row.PriceInc) ?? 0) * qty)
      const unitPrice = qty > 0 ? round2(lineTotal / qty) : lineTotal
      const product = productByLegacy.get(`${itemNo}|${itemType}`)
      if (!product) {
        missingProducts += 1
        continue
      }
      lines.push({
        productId: product._id,
        name: str(row.Description)?.trim() || product.name,
        sku: product.sku,
        quantity: qty,
        unitPrice,
        lineTotal,
      })
    }

    if (lines.length === 0) {
      skip('no_matched_products')
      continue
    }
    if (missingProducts > 0 && samples.length < 8) {
      samples.push(`${layByNumber}: ${missingProducts} line(s) skipped (product not in catalog)`)
    }

    const openRow = history.find((h) => h.TransType === 0) ?? history[0]!
    const openDate = parseTrackDate(openRow.Date) ?? new Date()
    const lastDate =
      parseTrackDate(last.Date) ?? parseTrackDate(history[history.length - 1]?.Date) ?? openDate

    const paymentRows = history.filter((h) => h.TransType === 1)
    const payments = paymentRows.map((p) => {
      const amount = round2(Math.abs(num(p.TransVal) ?? 0))
      const terminal = num(p.Terminal)
      return {
        amount,
        cashAmount: amount,
        cardAmount: 0,
        storeCreditAmount: 0,
        tillCode: terminal != null ? `T${terminal}` : undefined,
        createdAt: parseTrackDate(p.Date) ?? openDate,
        createdBy: createdById,
      }
    })

    const amountPaid = round2(payments.reduce((s, p) => s + p.amount, 0))
    const totalInclVat = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
    const totalVatAmount = round2(vatAmountFromInclusive(totalInclVat, vatRate))
    const totalNetAmount = round2(totalInclVat - totalVatAmount)

    const firstPayment = payments[0]?.amount ?? 0
    const depositPercentUsed =
      totalInclVat > 0.005
        ? Math.min(100, Math.max(0, Math.round((firstPayment / totalInclVat) * 100)))
        : (settings.defaultDepositPercent ?? 30)
    const depositAmount = round2((totalInclVat * depositPercentUsed) / 100)

    let expiresAt = new Date(openDate)
    expiresAt.setMonth(expiresAt.getMonth() + defaultExpiryMonths)
    if (isActive && expiresAt.getTime() < Date.now()) {
      expiresAt = new Date()
      expiresAt.setMonth(expiresAt.getMonth() + defaultExpiryMonths)
    }

    const customerName = str(c.CustName) || `Lay-by ${layByNo}`

    let phone = normalizePhone(str(c.TelNo) || '')
    if (!phone) {
      phone = `27${String(layByNo).padStart(9, '0').slice(-9)}`
    }

    const doc = {
      layByNumber,
      customerName,
      phone,
      lines,
      vatRate,
      totalInclVat,
      totalVatAmount,
      totalNetAmount,
      depositPercentUsed,
      depositAmount,
      amountPaid,
      balance: isActive ? balance : 0,
      status: isActive ? ('active' as const) : ('completed' as const),
      expiresAt,
      payments,
      createdBy: createdById,
      createdAt: openDate,
      updatedAt: lastDate,
    }

    if (!dryRun) {
      const existing = await LayBy.findOne({ layByNumber }).select('_id').lean()
      if (existing && !replace) {
        skip('already_exists')
        continue
      }
      if (existing) {
        await LayBy.updateOne({ _id: existing._id }, { $set: doc })
      } else {
        await LayBy.create(doc)
      }
    }

    migrated += 1
  }

  if (!dryRun) {
    const maxVectorNo = Math.max(...cust.map((c) => c.LayByNo))
    const nextSeq = Math.max(settings.nextLayBySeq ?? 1, maxVectorNo + 1)
    await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: { nextLayBySeq: nextSeq } },
      { upsert: true },
    )
    console.log(`Updated nextLayBySeq to ${nextSeq}`)
  }

  console.log(`Vector rpos: ${vectorRpos}`)
  console.log(`LaybyCust: ${cust.length} · LaybyTrans: ${trans.length} · LaybyTrack: ${track.length}`)
  console.log(`Mode: ${activeOnly ? 'active only' : 'all'}${dryRun ? ' (dry-run)' : ''}`)
  console.log(`Considered: ${considered}`)
  console.log(`${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated}`)
  console.log(`Skipped: ${skipped}`)
  if (Object.keys(skipReasons).length > 0) {
    console.log('Skip reasons:', skipReasons)
  }
  if (samples.length > 0) {
    console.log('Notes:')
    for (const s of samples) console.log(`  - ${s}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    try {
      if (LayBy.db.readyState !== 0) await LayBy.db.close()
    } catch {
      // ignore
    }
  })
