/**
 * Repair broken user→role links (e.g. after store restore) without using Back Office.
 *
 * Usage (on the affected machine, from server/):
 *   npm run repair:user-roles
 */
import 'dotenv/config'
import { connectDb } from '../src/config/db.js'
import { loadConfig } from '../src/config/loadConfig.js'
import { User } from '../src/models/User.js'
import { repairUserRoleLinks } from '../src/services/userRoleRepair.js'

async function main() {
  const config = loadConfig()
  await connectDb(config.mongodbUri)

  const before = await User.countDocuments()
  console.log(`Users in database: ${before}`)

  const result = await repairUserRoleLinks()
  console.log(`Repaired role links: ${result.fixed}`)
  if (result.unresolved > 0) {
    console.error(`Could not repair ${result.unresolved} user(s). Check roles collection in MongoDB.`)
    process.exit(1)
  }

  console.log('Done. Sign in to Back Office with your restored user email and password.')
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
