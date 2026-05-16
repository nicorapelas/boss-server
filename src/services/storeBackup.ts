import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Types } from 'mongoose'
import { ensureRolesAndMigrateUsers } from '../bootstrap/ensureRoles.js'
import { coerceObjectId } from '../utils/objectId.js'
import { HouseAccount, HouseAccountLedger } from '../models/HouseAccount.js'
import { LayBy } from '../models/LayBy.js'
import { OpenTab } from '../models/OpenTab.js'
import { Product } from '../models/Product.js'
import { Quote } from '../models/Quote.js'
import { Role } from '../models/Role.js'
import { Sale } from '../models/Sale.js'
import { SaleRefund } from '../models/SaleRefund.js'
import { ShiftSession } from '../models/ShiftSession.js'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'
import { StoreSettings } from '../models/StoreSettings.js'
import { Supplier } from '../models/Supplier.js'
import { SupplierOffer } from '../models/SupplierOffer.js'
import { User } from '../models/User.js'
import { getProductPhotosDir, productPhotoFilePath } from '../utils/productPhotoPaths.js'

export const STORE_BACKUP_FORMAT_VERSION = 1

export type StoreBackupManifest = {
  formatVersion: number
  mode: 'full'
  exportedAt: string
  includesPhotos: boolean
  counts: Record<string, number>
}

type JsonDoc = Record<string, unknown>

function serializeDocs(docs: unknown[]): string {
  return JSON.stringify(docs, (_k, v) => {
    if (v instanceof Types.ObjectId) return { $oid: String(v) }
    if (v instanceof Date) return { $date: String(v.toISOString()) }
    return v
  })
}

function reviveValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (Array.isArray(v)) return v.map(reviveValue)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$oid === 'string') return new Types.ObjectId(o.$oid)
    if (typeof o.$date === 'string') return new Date(o.$date)
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(o)) {
      out[k] = reviveValue(val)
    }
    return out
  }
  return v
}

function parseDocs(json: string): JsonDoc[] {
  const raw = JSON.parse(json) as unknown
  if (!Array.isArray(raw)) throw new Error('Expected JSON array')
  return raw.map((row) => reviveValue(row) as JsonDoc)
}

type ZipArchiveInstance = {
  append: (source: string | Buffer, data: { name: string }) => void
  file: (filepath: string, data: { name: string }) => void
  finalize: () => void
  on: (event: string, listener: (err: Error) => void) => void
}

async function createZipArchive(zlibLevel: number): Promise<NodeJS.ReadableStream & ZipArchiveInstance> {
  const mod = (await import('archiver')) as unknown as {
    ZipArchive: new (options?: { zlib?: { level?: number } }) => NodeJS.ReadableStream &
      ZipArchiveInstance
  }
  return new mod.ZipArchive({ zlib: { level: zlibLevel } })
}

const DATA_FILES = [
  'roles.json',
  'users.json',
  'products.json',
  'suppliers.json',
  'supplier-offers.json',
  'store-settings.json',
  'house-accounts.json',
  'store-credit-accounts.json',
  'shifts.json',
  'sales.json',
  'sale-refunds.json',
  'lay-bys.json',
  'quotes.json',
  'open-tabs.json',
  'house-account-ledger.json',
  'store-credit-ledger.json',
] as const

export async function buildStoreBackupZip(opts: { includePhotos: boolean }): Promise<{
  stream: NodeJS.ReadableStream
  filename: string
}> {
  const [
    roles,
    users,
    products,
    suppliers,
    supplierOffers,
    storeSettings,
    houseAccounts,
    storeCreditAccounts,
    shifts,
    sales,
    saleRefunds,
    layBys,
    quotes,
    openTabs,
    houseLedger,
    storeCreditLedger,
  ] = await Promise.all([
    Role.find().lean(),
    User.find().lean(),
    Product.find().lean(),
    Supplier.find().lean(),
    SupplierOffer.find().lean(),
    StoreSettings.find().lean(),
    HouseAccount.find().lean(),
    StoreCreditAccount.find().lean(),
    ShiftSession.find().lean(),
    Sale.find().lean(),
    SaleRefund.find().lean(),
    LayBy.find().lean(),
    Quote.find().lean(),
    OpenTab.find().lean(),
    HouseAccountLedger.find().lean(),
    StoreCreditLedger.find().lean(),
  ])

  const usersSanitized = users.map((u) => ({
    ...u,
    refreshTokenHash: null,
    refreshTokenExpires: null,
  }))

  const manifest: StoreBackupManifest = {
    formatVersion: STORE_BACKUP_FORMAT_VERSION,
    mode: 'full',
    exportedAt: new Date().toISOString(),
    includesPhotos: opts.includePhotos,
    counts: {
      roles: roles.length,
      users: users.length,
      products: products.length,
      suppliers: suppliers.length,
      supplierOffers: supplierOffers.length,
      storeSettings: storeSettings.length,
      houseAccounts: houseAccounts.length,
      storeCreditAccounts: storeCreditAccounts.length,
      shifts: shifts.length,
      sales: sales.length,
      saleRefunds: saleRefunds.length,
      layBys: layBys.length,
      quotes: quotes.length,
      openTabs: openTabs.length,
      houseAccountLedger: houseLedger.length,
      storeCreditLedger: storeCreditLedger.length,
    },
  }

  const datasets: Array<[string, unknown[]]> = [
    ['roles.json', roles],
    ['users.json', usersSanitized],
    ['products.json', products],
    ['suppliers.json', suppliers],
    ['supplier-offers.json', supplierOffers],
    ['store-settings.json', storeSettings],
    ['house-accounts.json', houseAccounts],
    ['store-credit-accounts.json', storeCreditAccounts],
    ['shifts.json', shifts],
    ['sales.json', sales],
    ['sale-refunds.json', saleRefunds],
    ['lay-bys.json', layBys],
    ['quotes.json', quotes],
    ['open-tabs.json', openTabs],
    ['house-account-ledger.json', houseLedger],
    ['store-credit-ledger.json', storeCreditLedger],
  ]

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `cogniBackup-${stamp}.zip`

  const archive = await createZipArchive(6)
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

  for (const [name, rows] of datasets) {
    archive.append(serializeDocs(rows), { name: `data/${name}` })
  }

  if (opts.includePhotos) {
    const photosDir = getProductPhotosDir()
    for (const p of products) {
      const id = String(p._id)
      const rev = p.photoRevision ?? 0
      if (rev <= 0) continue
      const filePath = productPhotoFilePath(id)
      try {
        await fsp.access(filePath)
        archive.file(filePath, { name: `photos/${id}.webp` })
      } catch {
        // missing file on disk — skip
      }
    }
    void photosDir
  }

  archive.finalize()

  return { stream: archive, filename }
}

async function deleteAllProductPhotos(): Promise<void> {
  const dir = getProductPhotosDir()
  try {
    const names = await fsp.readdir(dir)
    await Promise.all(
      names.map((n) => fsp.unlink(path.join(dir, n)).catch(() => undefined)),
    )
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') throw e
  }
}

async function wipeStoreCollections(): Promise<void> {
  await Promise.all([
    SaleRefund.deleteMany({}),
    HouseAccountLedger.deleteMany({}),
    StoreCreditLedger.deleteMany({}),
    OpenTab.deleteMany({}),
    LayBy.deleteMany({}),
    Quote.deleteMany({}),
    Sale.deleteMany({}),
    ShiftSession.deleteMany({}),
    SupplierOffer.deleteMany({}),
    Product.deleteMany({}),
    Supplier.deleteMany({}),
    User.deleteMany({}),
    Role.deleteMany({}),
    StoreSettings.deleteMany({}),
    HouseAccount.deleteMany({}),
    StoreCreditAccount.deleteMany({}),
  ])
  await deleteAllProductPhotos()
}

type InsertManyModel = {
  insertMany: (docs: JsonDoc[], opts?: { ordered?: boolean }) => Promise<unknown>
}

async function insertManyPreservingIds(model: InsertManyModel, docs: JsonDoc[]): Promise<number> {
  if (docs.length === 0) return 0
  await model.insertMany(docs, { ordered: false })
  return docs.length
}

function normalizeRestoredUser(
  doc: JsonDoc,
  slugHints: Map<string, string>,
): JsonDoc {
  const out: JsonDoc = { ...doc }
  const embedded = doc.roleId
  let roleId = coerceObjectId(embedded)
  let slugHint: string | undefined

  if (!roleId && embedded && typeof embedded === 'object') {
    const emb = embedded as { slug?: unknown; _id?: unknown }
    if (typeof emb.slug === 'string') slugHint = emb.slug.toLowerCase()
    roleId = coerceObjectId(emb._id)
  }

  const userId = coerceObjectId(doc._id)
  if (slugHint && userId) slugHints.set(String(userId), slugHint)

  if (roleId) out.roleId = roleId
  else delete out.roleId
  return out
}

async function repairRestoredUserRoles(
  slugHints: Map<string, string>,
): Promise<{ fixed: number; unresolved: number }> {
  const roles = await Role.find().lean()
  const roleIdSet = new Set(roles.map((r) => String(r._id)))
  const roleBySlug = new Map(roles.map((r) => [r.slug, r._id]))

  let fixed = 0
  let unresolved = 0

  const users = await User.find().select('roleId').lean()
  for (const u of users) {
    const userId = String(u._id)
    let roleId = coerceObjectId(u.roleId)
    if (roleId && roleIdSet.has(String(roleId))) continue

    if (!roleId && u.roleId && typeof u.roleId === 'object' && 'slug' in (u.roleId as object)) {
      roleId = coerceObjectId((u.roleId as { _id?: unknown })._id)
    }
    if (roleId && roleIdSet.has(String(roleId))) {
      await User.updateOne({ _id: u._id }, { $set: { roleId } })
      fixed += 1
      continue
    }

    const slugHint = slugHints.get(userId)
    const fallbackSlug =
      slugHint === 'admin' ? 'admin' : slugHint === 'manager' ? 'manager' : 'cashier'
    const fallback =
      (slugHint ? roleBySlug.get(slugHint) : undefined) ??
      roleBySlug.get(fallbackSlug) ??
      roleBySlug.get('admin') ??
      roles[0]?._id

    if (!fallback) {
      unresolved += 1
      continue
    }

    await User.updateOne({ _id: u._id }, { $set: { roleId: fallback } })
    fixed += 1
  }

  return { fixed, unresolved }
}

export type StoreRestoreResult = {
  manifest: StoreBackupManifest
  inserted: Record<string, number>
  roleRepair?: { fixed: number; unresolved: number }
}

export async function restoreStoreBackupFromZip(zipPath: string): Promise<StoreRestoreResult> {
  const zip = new AdmZip(zipPath)
  const manifestEntry = zip.getEntry('manifest.json')
  if (!manifestEntry) throw new Error('Invalid backup: missing manifest.json')
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as StoreBackupManifest
  if (manifest.formatVersion !== STORE_BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version ${manifest.formatVersion}`)
  }
  if (manifest.mode !== 'full') {
    throw new Error('Only full store backups can be restored')
  }

  const data: Record<string, JsonDoc[]> = {}
  for (const file of DATA_FILES) {
    const entry = zip.getEntry(`data/${file}`)
    if (!entry) throw new Error(`Invalid backup: missing data/${file}`)
    data[file] = parseDocs(entry.getData().toString('utf8'))
  }

  await wipeStoreCollections()

  const inserted: Record<string, number> = {}

  inserted.roles = await insertManyPreservingIds(Role, data['roles.json'])
  const userRoleSlugHints = new Map<string, string>()
  const restoredUsers = data['users.json'].map((u) => normalizeRestoredUser(u, userRoleSlugHints))
  inserted.users = await insertManyPreservingIds(User, restoredUsers)
  inserted.products = await insertManyPreservingIds(Product, data['products.json'])
  inserted.suppliers = await insertManyPreservingIds(Supplier, data['suppliers.json'])
  inserted.supplierOffers = await insertManyPreservingIds(SupplierOffer, data['supplier-offers.json'])
  inserted.storeSettings = await insertManyPreservingIds(StoreSettings, data['store-settings.json'])
  inserted.houseAccounts = await insertManyPreservingIds(HouseAccount, data['house-accounts.json'])
  inserted.storeCreditAccounts = await insertManyPreservingIds(
    StoreCreditAccount,
    data['store-credit-accounts.json'],
  )
  inserted.shifts = await insertManyPreservingIds(ShiftSession, data['shifts.json'])
  inserted.sales = await insertManyPreservingIds(Sale, data['sales.json'])
  inserted.saleRefunds = await insertManyPreservingIds(SaleRefund, data['sale-refunds.json'])
  inserted.layBys = await insertManyPreservingIds(LayBy, data['lay-bys.json'])
  inserted.quotes = await insertManyPreservingIds(Quote, data['quotes.json'])
  inserted.openTabs = await insertManyPreservingIds(OpenTab, data['open-tabs.json'])
  inserted.houseAccountLedger = await insertManyPreservingIds(
    HouseAccountLedger,
    data['house-account-ledger.json'],
  )
  inserted.storeCreditLedger = await insertManyPreservingIds(
    StoreCreditLedger,
    data['store-credit-ledger.json'],
  )

  if (manifest.includesPhotos) {
    const photosDir = getProductPhotosDir()
    await fsp.mkdir(photosDir, { recursive: true })
    const entries = zip.getEntries().filter((e) => e.entryName.startsWith('photos/') && !e.isDirectory)
    let photosRestored = 0
    for (const entry of entries) {
      const base = path.basename(entry.entryName)
      if (!base.endsWith('.webp')) continue
      const dest = path.join(photosDir, base)
      await fsp.writeFile(dest, entry.getData())
      photosRestored += 1
    }
    inserted.photos = photosRestored
  }

  await User.updateMany({}, { $set: { refreshTokenHash: null, refreshTokenExpires: null } })

  await ensureRolesAndMigrateUsers()
  const roleRepair = await repairRestoredUserRoles(userRoleSlugHints)
  if (roleRepair.unresolved > 0) {
    throw new Error(
      `${roleRepair.unresolved} user(s) could not be linked to a role after restore. Check roles.json in the backup.`,
    )
  }

  return { manifest, inserted, roleRepair }
}

export async function previewStoreBackupZip(zipPath: string): Promise<StoreBackupManifest> {
  const zip = new AdmZip(zipPath)
  const manifestEntry = zip.getEntry('manifest.json')
  if (!manifestEntry) throw new Error('Invalid backup: missing manifest.json')
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as StoreBackupManifest
  if (manifest.formatVersion !== STORE_BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version ${manifest.formatVersion}`)
  }
  return manifest
}

export async function streamBackupToResponse(
  res: import('express').Response,
  includePhotos: boolean,
): Promise<void> {
  const { stream, filename } = await buildStoreBackupZip({ includePhotos })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('X-Backup-Filename', filename)
  await pipeline(stream, res)
}
