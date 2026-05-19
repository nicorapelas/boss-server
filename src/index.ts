import 'dotenv/config'
import { loadConfig } from './config/loadConfig.js'
import { createApp } from './app.js'
import { connectDb } from './config/db.js'
import { ensureRolesAndMigrateUsers } from './bootstrap/ensureRoles.js'
import { bootstrapQuoteSequences } from './controllers/quotes.controller.js'
import { repairUserRoleLinks } from './services/userRoleRepair.js'

async function main() {
  const config = loadConfig()

  await connectDb(config.mongodbUri)
  await ensureRolesAndMigrateUsers()
  const roleRepair = await repairUserRoleLinks()
  if (roleRepair.fixed > 0) {
    console.log(`[startup] Repaired ${roleRepair.fixed} user→role link(s)`)
  }
  if (roleRepair.unresolved > 0) {
    console.warn(
      `[startup] ${roleRepair.unresolved} user(s) still missing a valid role — run: npm run repair:user-roles`,
    )
  }
  await bootstrapQuoteSequences()

  const app = createApp({
    accessTokenSecret: config.accessTokenSecret,
    refreshTokenSecret: config.refreshTokenSecret,
    corsOrigins: config.corsOrigins,
    env: config.env,
  })

  app.listen(config.port, () => {
    console.log(
      `cognipos-server [${config.env}] listening on http://localhost:${config.port}`,
    )
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
