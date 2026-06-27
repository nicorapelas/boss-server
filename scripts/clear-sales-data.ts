/**
 * Clear all sales / transactional data for go-live (keeps catalog, users, settings).
 *
 * Usage (from server/):
 *   npm run clear:sales -- --confirm
 *
 * Production (on shop server):
 *   NODE_ENV=production MONGODB_URI=... npm run clear:sales -- --confirm
 */
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { User } from '../src/models/User.js'
import { clearSalesData } from '../src/services/clearSalesData.js'

async function main() {
  const confirmed = process.argv.includes('--confirm')
  if (!confirmed) {
    console.error('This permanently deletes sales, shifts, refunds, tabs, lay-bys, quotes,')
    console.error('ledgers, loyalty history, and stock adjustment logs.')
    console.error('Catalog, users, roles, and store settings are kept.')
    console.error('')
    console.error('Re-run with: npm run clear:sales -- --confirm')
    process.exit(1)
  }

  const config = loadConfig()
  await connectDb(config.mongodbUri)

  console.log(`Connected (${config.env}). Clearing sales data…`)
  const result = await clearSalesData()
  console.log('Done.')
  console.log(JSON.stringify(result, null, 2))
  console.log('')
  console.log('Also clear POS offline queues on each till (if any):')
  console.log('  rm -f ~/.config/*/pos-offline.db   # or sign out and use Settings if added later')
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
