import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MONGO_CLOUD_BACKUP,
  mongoDatabaseFromUri,
  parseScheduleTime,
} from './mongoCloudBackup.js'
import type { AppEnvironment, FileConfig, ResolvedConfig } from './types.js'
import type { MongoCloudBackupConfig } from './mongoCloudBackup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveEnv(): AppEnvironment {
  const n = process.env.NODE_ENV
  if (n === 'production') return 'production'
  return 'development'
}

function readFileConfig(env: AppEnvironment): FileConfig {
  const configDir = path.join(__dirname, '../../config')
  const filePath = path.join(configDir, `${env}.json`)
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as FileConfig
}

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim()
    }
  }
  return ''
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseCorsOrigins(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) return fallback
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
  const v = String(raw).trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return fallback
}

function resolveMongoCloudBackup(
  file: FileConfig,
  mongodbUri: string,
): MongoCloudBackupConfig {
  const fromFile = file.mongoCloudBackup ?? {}
  const schedule = firstNonEmpty(process.env.MONGO_CLOUD_BACKUP_SCHEDULE, fromFile.schedule) ||
    DEFAULT_MONGO_CLOUD_BACKUP.schedule
  parseScheduleTime(schedule)

  const databaseName =
    firstNonEmpty(
      process.env.MONGO_CLOUD_BACKUP_DATABASE,
      fromFile.databaseName,
    ) || mongoDatabaseFromUri(mongodbUri)

  return {
    enabled: parseBool(process.env.MONGO_CLOUD_BACKUP_ENABLED, fromFile.enabled ?? false),
    schedule,
    destinationUri: firstNonEmpty(
      process.env.MONGO_CLOUD_BACKUP_URI,
      fromFile.destinationUri,
    ),
    databaseName,
    dockerMongoContainer:
      firstNonEmpty(process.env.MONGO_CLOUD_BACKUP_DOCKER_CONTAINER, fromFile.dockerMongoContainer) ||
      DEFAULT_MONGO_CLOUD_BACKUP.dockerMongoContainer,
  }
}

/**
 * Loads `config/development.json` or `config/production.json` based on NODE_ENV,
 * then merges with process.env (env wins). In production, secrets must be set via env.
 */
export function loadConfig(): ResolvedConfig {
  const env = resolveEnv()
  const file = readFileConfig(env)

  const port = parsePort(process.env.PORT, file.port)
  const mongodbUri = firstNonEmpty(process.env.MONGODB_URI, file.mongodbUri)
  const accessTokenSecret = firstNonEmpty(process.env.ACCESS_TOKEN_SECRET, file.accessTokenSecret)
  const refreshTokenSecret = firstNonEmpty(process.env.REFRESH_TOKEN_SECRET, file.refreshTokenSecret)
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS, file.corsOrigins)

  if (env === 'production') {
    if (!mongodbUri) {
      throw new Error('Production: set MONGODB_URI in the environment')
    }
    if (!accessTokenSecret || !refreshTokenSecret) {
      throw new Error(
        'Production: set ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET in the environment (not in config files)',
      )
    }
  } else {
    if (!mongodbUri) {
      throw new Error('Missing MONGODB_URI (config/development.json or MONGODB_URI env)')
    }
    if (!accessTokenSecret || !refreshTokenSecret) {
      throw new Error('Missing JWT secrets (config/development.json or env)')
    }
  }

  const mongoCloudBackup = resolveMongoCloudBackup(file, mongodbUri)

  return {
    env,
    port,
    mongodbUri,
    accessTokenSecret,
    refreshTokenSecret,
    corsOrigins,
    mongoCloudBackup,
  }
}
