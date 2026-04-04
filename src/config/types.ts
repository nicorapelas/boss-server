export type AppEnvironment = 'development' | 'production'

export interface FileConfig {
  port: number
  mongodbUri: string
  accessTokenSecret: string
  refreshTokenSecret: string
  corsOrigins: string[]
}

export interface ResolvedConfig extends FileConfig {
  env: AppEnvironment
}
