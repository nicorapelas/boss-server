import { loadConfig } from '../config/loadConfig.js'
import { parseScheduleTime } from '../config/mongoCloudBackup.js'
import { runMongoCloudBackup } from './mongoCloudBackup.service.js'

function msUntilNextLocalTime(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime() - now.getTime()
}

function scheduleDaily(hour: number, minute: number, label: string): void {
  const delay = msUntilNextLocalTime(hour, minute)
  setTimeout(() => {
    void runMongoCloudBackup('scheduled')
      .then((result) => {
        console.log(
          `[mongo-cloud-backup] scheduled backup ok — ${result.databaseName}, ${result.archiveBytes} bytes`,
        )
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[mongo-cloud-backup] scheduled backup failed: ${message}`)
      })
      .finally(() => scheduleDaily(hour, minute, label))
  }, delay)
}

export function startMongoCloudBackupScheduler(): void {
  const config = loadConfig()
  const cloud = config.mongoCloudBackup

  if (!cloud.enabled) {
    return
  }

  if (!cloud.destinationUri) {
    console.warn(
      '[mongo-cloud-backup] enabled but destination URI missing — daily scheduler not started',
    )
    return
  }

  let parsed: { hour: number; minute: number; label: string }
  try {
    parsed = parseScheduleTime(cloud.schedule)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[mongo-cloud-backup] invalid schedule — ${message}`)
    return
  }

  scheduleDaily(parsed.hour, parsed.minute, parsed.label)
  console.log(
    `[mongo-cloud-backup] daily scheduler active at ${parsed.label} local time (${cloud.databaseName})`,
  )
}
