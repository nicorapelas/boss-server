export interface MongoCloudBackupConfig {
  /** When true, run daily at `schedule` and allow manual cloud backup from Back Office. */
  enabled: boolean
  /** Local time 24h, e.g. "13:00". */
  schedule: string
  /**
   * MongoDB Atlas (or other remote) URI for off-site mirror.
   * In production prefer MONGO_CLOUD_BACKUP_URI env over this file.
   */
  destinationUri: string
  /** Source database name; inferred from mongodbUri when empty. */
  databaseName: string
  /** When host mongodump is missing, use tools inside this Docker Mongo container (dev). */
  dockerMongoContainer?: string
}

export const DEFAULT_MONGO_CLOUD_BACKUP: MongoCloudBackupConfig = {
  enabled: false,
  schedule: '13:00',
  destinationUri: '',
  databaseName: '',
  dockerMongoContainer: 'electropos-mongo',
}

export function mongoDatabaseFromUri(uri: string): string {
  const match = uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)
  if (match?.[1]) return match[1]
  return 'electropos'
}

export function parseScheduleTime(raw: string): { hour: number; minute: number; label: string } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!m) {
    throw new Error(`Invalid mongoCloudBackup.schedule "${raw}" — use HH:mm (e.g. 13:00)`)
  }
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid mongoCloudBackup.schedule hour in "${raw}"`)
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`Invalid mongoCloudBackup.schedule minute in "${raw}"`)
  }
  const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return { hour, minute, label }
}
