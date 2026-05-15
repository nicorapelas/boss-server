import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import MDBReader from 'mdb-reader'
import { Product } from '../models/Product.js'

type Row = Record<string, unknown>

export type VectorImportResult = {
  pluRowsTotal: number
  considered: number
  migrated: number
  skipped: number
  dryRun: boolean
}

export type VectorSkuNormalizeResult = {
  productsTotal: number
  candidates: number
  updated: number
  conflicts: number
  conflictSamples: Array<{ currentSku: string; targetSku: string; reason: string }>
  dryRun: boolean
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

/** Locate Ramset.dat + RamStock.dat in an extracted RP_BACK folder (root or one subfolder). */
export async function resolveVectorDatDir(root: string): Promise<{
  dir: string
  ramsetPath: string
  ramstockPath: string
}> {
  const tryDir = async (dir: string) => {
    const ramsetPath = path.join(dir, 'Ramset.dat')
    const ramstockPath = path.join(dir, 'RamStock.dat')
    if ((await pathExists(ramsetPath)) && (await pathExists(ramstockPath))) {
      return { dir, ramsetPath, ramstockPath }
    }
    return null
  }

  const direct = await tryDir(root)
  if (direct) return direct

  const entries = await fsp.readdir(root, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const hit = await tryDir(path.join(root, e.name))
    if (hit) return hit
  }

  throw new Error(
    'Could not find Ramset.dat and RamStock.dat in the upload. Use a ZIP of the Vector RP_BACK folder.',
  )
}

export async function importVectorProductsFromDir(
  vectorBase: string,
  opts: { dryRun?: boolean } = {},
): Promise<VectorImportResult> {
  const dryRun = Boolean(opts.dryRun)
  const { ramsetPath, ramstockPath } = await resolveVectorDatDir(vectorBase)

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

  for (const r of pluRows) {
    const itemNo = num(r['ItemNo'])
    const itemType = num(r['ItemType']) ?? 0
    const name = str(r['Name'])
    const enabled = bool(r['Enabled'])
    if (itemNo === undefined || !name || !enabled || name.startsWith('*ITEMS PREVIOUSLY DELETED')) {
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

  return {
    pluRowsTotal: pluRows.length,
    considered,
    migrated,
    skipped,
    dryRun,
  }
}

export async function normalizeVectorProductSkus(opts: { dryRun?: boolean } = {}): Promise<VectorSkuNormalizeResult> {
  const dryRun = Boolean(opts.dryRun)
  const all = await Product.find().select('_id sku').lean()
  const bySku = new Map<string, string>()
  for (const p of all) {
    bySku.set(p.sku, String(p._id))
  }

  const vecPattern = /^VEC-(\d+)-\d+$/i
  type Candidate = {
    id: string
    currentSku: string
    targetSku: string
    baseSku: string
    itemType: number
  }
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

  const conflicts: Array<{ currentSku: string; targetSku: string; reason: string }> = []
  const reservedTargets = new Set<string>()
  const safe: Candidate[] = []

  for (const c of candidates) {
    let targetSku = c.targetSku
    const owner = bySku.get(targetSku)
    if (owner && owner !== c.id) {
      const fallback = `${c.baseSku}-${c.itemType}`
      const fallbackOwner = bySku.get(fallback)
      if (!fallbackOwner || fallbackOwner === c.id) {
        targetSku = fallback
      } else {
        conflicts.push({
          currentSku: c.currentSku,
          targetSku,
          reason: `target SKU already exists (${owner}); fallback ${fallback} also taken`,
        })
        continue
      }
    }
    if (reservedTargets.has(targetSku)) {
      conflicts.push({
        currentSku: c.currentSku,
        targetSku,
        reason: 'target SKU duplicated within batch',
      })
      continue
    }
    reservedTargets.add(targetSku)
    safe.push({ ...c, targetSku })
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

  return {
    productsTotal: all.length,
    candidates: candidates.length,
    updated: safe.length,
    conflicts: conflicts.length,
    conflictSamples: conflicts.slice(0, 20),
    dryRun,
  }
}
