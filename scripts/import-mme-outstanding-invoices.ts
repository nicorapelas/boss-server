/**
 * One-off: import MME Manufacturing outstanding invoices from the physical ledger book.
 *
 * Usage (from server/):
 *   NODE_ENV=development tsx scripts/import-mme-outstanding-invoices.ts
 *   NODE_ENV=development tsx scripts/import-mme-outstanding-invoices.ts --confirm
 */
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { HouseAccount, HouseAccountLedger } from '../src/models/HouseAccount.js'
import { User } from '../src/models/User.js'

const ACCOUNT_NUMBER = 'ACC-00003'
const IMPORT_TAG = 'opening-import-mme'

const OUTSTANDING = [
  {
    invoiceDate: new Date(2026, 4, 11), // 11/5/26
    invoiceNr: '1149',
    orderRef: 'Dirk',
    amount: 450.0,
  },
  {
    invoiceDate: new Date(2026, 4, 14), // 14/5/26
    invoiceNr: '1151',
    orderRef: 'Dirk',
    amount: 399.95,
  },
  {
    invoiceDate: new Date(2026, 4, 14), // 14/5/26
    invoiceNr: '1152',
    orderRef: '58532',
    amount: 2932.5,
  },
] as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function main() {
  const confirmed = process.argv.includes('--confirm')
  if (!confirmed) {
    console.error('Imports 3 outstanding MME charges into house account ACC-00003.')
    console.error('Re-run with: NODE_ENV=development tsx scripts/import-mme-outstanding-invoices.ts --confirm')
    process.exit(1)
  }

  const config = loadConfig()
  await connectDb(config.mongodbUri)

  const acct = await HouseAccount.findOne({ accountNumber: ACCOUNT_NUMBER })
  if (!acct) {
    console.error(`House account ${ACCOUNT_NUMBER} not found`)
    process.exit(1)
  }

  const existing = await HouseAccountLedger.countDocuments({
    houseAccountId: acct._id,
    note: new RegExp(`^${IMPORT_TAG}:`),
  })
  if (existing > 0) {
    console.log(`Already imported (${existing} ledger rows tagged ${IMPORT_TAG}). Skipping.`)
    const fresh = await HouseAccount.findById(acct._id).lean()
    console.log(`Current balance: ${fresh?.balance?.toFixed(2) ?? '?'}`)
    return
  }

  let added = 0
  for (const row of OUTSTANDING) {
    const note = `${IMPORT_TAG}: inv ${row.invoiceNr}, order ${row.orderRef}`
    await HouseAccountLedger.create({
      houseAccountId: acct._id,
      accountNumber: acct.accountNumber,
      kind: 'charge',
      amount: round2(row.amount),
      saleId: null,
      note,
      createdAt: row.invoiceDate,
      updatedAt: row.invoiceDate,
    })
    acct.balance = round2(acct.balance + row.amount)
    added++
    console.log(`+ charge ${row.invoiceNr}  R ${row.amount.toFixed(2)}  (${row.invoiceDate.toLocaleDateString('en-ZA')})`)
  }

  await acct.save()

  const expected = round2(OUTSTANDING.reduce((s, r) => s + r.amount, 0))
  console.log('')
  console.log(`Imported ${added} charges. Balance now R ${acct.balance.toFixed(2)} (expected R ${expected.toFixed(2)})`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    try {
      if (User.db.readyState !== 0) await User.db.close()
    } catch {
      // ignore
    }
  })
