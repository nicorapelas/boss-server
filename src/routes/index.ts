import { Router } from 'express'
import { requireAuth as buildRequireAuth } from '../middleware/auth.middleware.js'
import { requireAdmin } from '../middleware/requireAdmin.middleware.js'
import { authRouter } from './auth.routes.js'
import { financialsRouter } from './financials.routes.js'
import { houseAccountsRouter } from './houseAccounts.routes.js'
import { laybyRouter } from './layby.routes.js'
import { migrationRouter } from './migration.routes.js'
import { productsRouter } from './products.routes.js'
import { quotesRouter } from './quotes.routes.js'
import { settingsRouter } from './settings.routes.js'
import { salesRouter } from './sales.routes.js'
import { storeCreditRouter } from './storeCredit.routes.js'
import { tabsRouter } from './tabs.routes.js'
import { usersRouter } from './users.routes.js'

export function apiRouter(accessSecret: string) {
  const requireAuth = buildRequireAuth(accessSecret)
  const r = Router()
  r.use('/auth', authRouter(requireAuth))
  r.use('/products', productsRouter(requireAuth, requireAdmin))
  r.use('/sales', salesRouter(requireAuth, requireAdmin))
  r.use('/tabs', tabsRouter(requireAuth))
  r.use('/financials', financialsRouter(requireAuth, requireAdmin))
  r.use('/settings', settingsRouter(requireAuth, requireAdmin))
  r.use('/store-credit', storeCreditRouter(requireAuth, requireAdmin))
  r.use('/house-accounts', houseAccountsRouter(requireAuth, requireAdmin))
  r.use('/lay-bys', laybyRouter(requireAuth, requireAdmin))
  r.use('/quotes', quotesRouter(requireAuth))
  r.use('/migration', migrationRouter(requireAuth, requireAdmin))
  r.use('/users', usersRouter(requireAuth, requireAdmin))
  return r
}
