import 'dotenv/config'
import { loadConfig } from './config/loadConfig.js'
import { createApp } from './app.js'
import { connectDb } from './config/db.js'
import { ensureRolesAndMigrateUsers } from './bootstrap/ensureRoles.js'
import { bootstrapQuoteSequences } from './controllers/quotes.controller.js'

async function main() {
  const config = loadConfig()

  await connectDb(config.mongodbUri)
  await ensureRolesAndMigrateUsers()
  await bootstrapQuoteSequences()

  const app = createApp({
    accessTokenSecret: config.accessTokenSecret,
    refreshTokenSecret: config.refreshTokenSecret,
    corsOrigins: config.corsOrigins,
    env: config.env,
  })

  app.listen(config.port, () => {
    console.log(
      `electropos-server [${config.env}] listening on http://localhost:${config.port}`,
    )
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
