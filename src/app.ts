import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import type { AppEnvironment } from './config/types.js'
import { apiRouter } from './routes/index.js'
import { notFound } from './middleware/notFound.middleware.js'
import { errorHandler } from './middleware/error.middleware.js'

export function createApp(options: {
  accessTokenSecret: string
  refreshTokenSecret: string
  corsOrigins: string[]
  env: AppEnvironment
}) {
  const app = express()
  app.set('accessTokenSecret', options.accessTokenSecret)
  app.set('refreshTokenSecret', options.refreshTokenSecret)

  app.use(helmet())
  // In development, reflect any origin so any Vite port (5173, 5174, …) works with Electron.
  // In production, use the configured allowlist (or allow all if the list is empty).
  const corsOrigin: boolean | string[] =
    options.env === 'development'
      ? true
      : options.corsOrigins.length > 0
        ? options.corsOrigins
        : true
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
      exposedHeaders: ['Content-Disposition', 'X-Backup-Filename'],
    }),
  )
  app.use(express.json())

  // Debug network/auth reachability from POS terminals without logging secrets.
  app.use((req, _res, next) => {
    if (req.path === '/api/auth/login' || req.path === '/api/auth/login-badge') {
      const sourceIp = req.ip || req.socket.remoteAddress || 'unknown'
      const origin = req.get('origin') ?? 'none'
      const userAgent = req.get('user-agent') ?? 'unknown'
      const bodyShape = req.body && typeof req.body === 'object' ? Object.keys(req.body as Record<string, unknown>) : []
      const now = new Date().toISOString()
      console.log(
        `[auth-attempt] ${now} method=${req.method} path=${req.path} ip=${sourceIp} origin=${origin} bodyKeys=${bodyShape.join(',')} ua=${userAgent}`,
      )
    }
    next()
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api', apiRouter(options.accessTokenSecret))

  app.use(notFound)
  app.use(errorHandler)

  return app
}
