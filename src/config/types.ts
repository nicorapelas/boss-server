import type { MongoCloudBackupConfig } from './mongoCloudBackup.js'

export type AppEnvironment = 'development' | 'production'

export interface FileConfig {
  port: number
  mongodbUri: string
  accessTokenSecret: string
  refreshTokenSecret: string
  corsOrigins: string[]
  mongoCloudBackup?: Partial<MongoCloudBackupConfig>
}

export interface ResolvedConfig extends FileConfig {
  env: AppEnvironment
  mongoCloudBackup: MongoCloudBackupConfig
}
