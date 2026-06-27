import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../config/loadConfig.js'
import { mongoDatabaseFromUri } from '../config/mongoCloudBackup.js'
import type { MongoCloudBackupConfig } from '../config/mongoCloudBackup.js'
import {
  archivePathForRunner,
  readArchiveBytes,
  removeArchive,
  resolveMongoToolsRunner,
  runMongoTool,
} from './mongoDatabaseTools.js'

export type MongoCloudBackupTrigger = 'manual' | 'scheduled'

export type MongoCloudBackupResult = {
  ok: true
  trigger: MongoCloudBackupTrigger
  startedAt: string
  finishedAt: string
  archiveBytes: number
  databaseName: string
}

export type MongoCloudBackupStatus = {
  enabled: boolean
  configured: boolean
  schedule: string
  databaseName: string
  running: boolean
  lastRun: MongoCloudBackupResult | null
  lastError: { at: string; message: string; trigger: MongoCloudBackupTrigger } | null
}

let backupInFlight: Promise<MongoCloudBackupResult> | null = null
let lastRun: MongoCloudBackupResult | null = null
let lastError: MongoCloudBackupStatus['lastError'] = null

export function getMongoCloudBackupStatus(): MongoCloudBackupStatus {
  const config = loadConfig()
  const cloud = config.mongoCloudBackup
  return {
    enabled: cloud.enabled,
    configured: Boolean(cloud.destinationUri),
    schedule: cloud.schedule,
    databaseName: cloud.databaseName || mongoDatabaseFromUri(config.mongodbUri),
    running: backupInFlight !== null,
    lastRun,
    lastError,
  }
}

export function assertMongoCloudBackupReady(
  cloud: MongoCloudBackupConfig,
  opts: { requireEnabled?: boolean } = {},
): void {
  if (opts.requireEnabled && !cloud.enabled) {
    throw new Error('Mongo cloud backup is disabled in config (mongoCloudBackup.enabled)')
  }
  if (!cloud.destinationUri) {
    throw new Error(
      'Mongo cloud backup destination URI is not set (mongoCloudBackup.destinationUri or MONGO_CLOUD_BACKUP_URI)',
    )
  }
}

async function dumpAndRestore(opts: {
  sourceUri: string
  destinationUri: string
  databaseName: string
  dockerMongoContainer?: string
  trigger: MongoCloudBackupTrigger
}): Promise<MongoCloudBackupResult> {
  const startedAt = new Date()
  const runner = await resolveMongoToolsRunner(opts.dockerMongoContainer)

  let archivePath = archivePathForRunner(runner, opts.databaseName)
  let hostTmpDir: string | null = null

  if (runner.mode === 'host') {
    hostTmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'electropos-mongo-cloud-'))
    archivePath = path.join(hostTmpDir, archivePath)
  }

  try {
    await runMongoTool(
      'mongodump',
      [`--uri=${opts.sourceUri}`, `--db=${opts.databaseName}`, `--archive=${archivePath}`, '--gzip'],
      runner,
    )

    const archiveBytes = await readArchiveBytes(archivePath, runner)

    await runMongoTool(
      'mongorestore',
      [
        `--uri=${opts.destinationUri}`,
        `--archive=${archivePath}`,
        '--gzip',
        '--drop',
        `--nsInclude=${opts.databaseName}.*`,
      ],
      runner,
    )

    const result: MongoCloudBackupResult = {
      ok: true,
      trigger: opts.trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      archiveBytes,
      databaseName: opts.databaseName,
    }
    lastRun = result
    lastError = null
    return result
  } finally {
    await removeArchive(archivePath, runner)
    if (hostTmpDir) {
      await fsp.rm(hostTmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export async function runMongoCloudBackup(
  trigger: MongoCloudBackupTrigger,
): Promise<MongoCloudBackupResult> {
  if (backupInFlight) {
    return backupInFlight
  }

  const config = loadConfig()
  const cloud = config.mongoCloudBackup
  assertMongoCloudBackupReady(cloud, { requireEnabled: trigger === 'scheduled' })

  const databaseName = cloud.databaseName || mongoDatabaseFromUri(config.mongodbUri)

  const work = dumpAndRestore({
    sourceUri: config.mongodbUri,
    destinationUri: cloud.destinationUri,
    databaseName,
    dockerMongoContainer: cloud.dockerMongoContainer,
    trigger,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    lastError = {
      at: new Date().toISOString(),
      message,
      trigger,
    }
    throw err
  })

  backupInFlight = work
  try {
    return await work
  } finally {
    backupInFlight = null
  }
}
