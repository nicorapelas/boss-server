import fs from 'node:fs'
import path from 'node:path'
import 'dotenv/config'
import MDBReader from 'mdb-reader'
import { hashPassword, User } from '../src/models/User.js'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'

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

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function readJetRows(filePath: string, tableName: string): Row[] {
  const buffer = fs.readFileSync(filePath)
  const reader = new MDBReader(buffer)
  return reader.getTable(tableName).getData()
}

function buildEmail(name: string, userNo: number): string {
  const s = slug(name) || `vector-user-${userNo}`
  return `${s}-${userNo}@vector.local`
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

  const usersPath = path.join(vectorBase, 'RamUsers.dat')
  const posHistPath = path.join(vectorBase, 'PosTransHist.dat')
  if (!fs.existsSync(usersPath) || !fs.existsSync(posHistPath)) {
    throw new Error(`Expected RamUsers.dat and PosTransHist.dat in ${vectorBase}`)
  }

  const details = readJetRows(usersPath, 'Details')
  const paymentRows = readJetRows(posHistPath, 'Payment')
  const itemRows = readJetRows(posHistPath, 'Items')

  const discoveredUserNos = new Set<number>()
  for (const r of paymentRows) {
    const u = num(r['User'])
    if (u !== undefined && u > 0) discoveredUserNos.add(u)
  }
  for (const r of itemRows) {
    const u = num(r['User'])
    if (u !== undefined && u > 0) discoveredUserNos.add(u)
  }

  const userRows: {
    userNo: number
    name: string
    level?: number
  }[] = []

  if (details.length > 0) {
    let idx = 1
    for (const r of details) {
      const name = str(r['Name']) || `Vector User ${idx}`
      const level = num(r['Level'])
      // table has a column called "Unique" but may not be stable user number in all installations
      const maybeNo = num(r['Unique']) ?? idx
      userRows.push({ userNo: maybeNo, name, level })
      idx += 1
    }
  }

  const seen = new Set<number>(userRows.map((u) => u.userNo))
  for (const no of Array.from(discoveredUserNos).sort((a, b) => a - b)) {
    if (!seen.has(no)) {
      userRows.push({ userNo: no, name: `Vector User ${no}` })
    }
  }

  if (!dryRun) {
    if (mongoUri) {
      await connectDb(mongoUri)
    } else {
      const config = loadConfig()
      await connectDb(config.mongodbUri)
    }
  }

  let createdOrUpdated = 0
  let skipped = 0
  let adminAssigned = false
  if (!dryRun) {
    adminAssigned = (await User.countDocuments({ role: 'admin' })) > 0
  }

  for (const u of userRows) {
    if (!u.userNo || u.userNo <= 0) {
      skipped += 1
      continue
    }

    const role = !adminAssigned && u.userNo === 1 ? 'admin' : 'cashier'
    if (role === 'admin') adminAssigned = true
    const email = buildEmail(u.name, u.userNo)
    const passwordHash = await hashPassword(`vector-import-${u.userNo}`)

    if (!dryRun) {
      await User.updateOne(
        { 'legacy.source': 'vector', 'legacy.userNo': u.userNo },
        {
          $set: {
            email,
            displayName: u.name,
            role,
            active: true,
            // imported accounts should be reviewed before granting login
            passwordHash,
            legacy: {
              source: 'vector',
              userNo: u.userNo,
              level: u.level,
              canLogin: false,
            },
          },
        },
        { upsert: true },
      )
    }
    createdOrUpdated += 1
  }

  console.log(`Vector Details rows: ${details.length}`)
  console.log(`Discovered user IDs in history: ${discoveredUserNos.size}`)
  console.log(`${dryRun ? 'Would upsert' : 'Upserted'} users: ${createdOrUpdated}`)
  console.log(`Skipped users: ${skipped}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    try {
      if (User.db.readyState !== 0) {
        await User.db.close()
      }
    } catch {
      // ignore close errors
    }
  })

