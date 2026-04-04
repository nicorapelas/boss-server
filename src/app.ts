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
    }),
  )
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api', apiRouter(options.accessTokenSecret))

  app.use(notFound)
  app.use(errorHandler)

  return app
}
