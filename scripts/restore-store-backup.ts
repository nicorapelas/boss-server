/**
 * Restore a store backup ZIP from the command line (no Back Office login).
 *
 * Usage (on the affected machine, from server/):
 *   npm run restore:store -- /path/to/cogniBackup-....zip
 */
import path from 'node:path'
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { User } from '../src/models/User.js'
import { restoreStoreBackupFromZip } from '../src/services/storeBackup.js'

async function main() {
  const zipArg = process.argv[2]
  if (!zipArg) {
    console.error('Usage: npm run restore:store -- <path-to-backup.zip>')
    process.exit(1)
  }

  const zipPath = path.resolve(zipArg)
  const config = loadConfig()
  await connectDb(config.mongodbUri)

  console.log(`Restoring from: ${zipPath}`)
  console.log('This replaces ALL store data in the database.')

  const result = await restoreStoreBackupFromZip(zipPath)
  console.log('Restore complete.')
  console.log(JSON.stringify({ inserted: result.inserted, roleRepair: result.roleRepair }, null, 2))
  console.log('All users must sign in again in Back Office and POS.')
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
