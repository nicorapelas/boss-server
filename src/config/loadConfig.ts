import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppEnvironment, FileConfig, ResolvedConfig } from './types.js'

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

  return {
    env,
    port,
    mongodbUri,
    accessTokenSecret,
    refreshTokenSecret,
    corsOrigins,
  }
}
