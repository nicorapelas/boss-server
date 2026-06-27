import 'dotenv/config'
import { runMongoCloudBackup } from '../src/services/mongoCloudBackup.service.js'

async function main() {
  const result = await runMongoCloudBackup('scheduled')
  console.log(
    `[mongo-cloud-backup] ok — ${result.databaseName}, ${result.archiveBytes} bytes, ${result.finishedAt}`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
