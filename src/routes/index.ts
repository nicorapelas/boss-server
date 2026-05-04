import { Router } from 'express'
import { requireAuth as buildRequireAuth } from '../middleware/auth.middleware.js'
import { authRouter } from './auth.routes.js'
import { financialsRouter } from './financials.routes.js'
import { houseAccountsRouter } from './houseAccounts.routes.js'
import { laybyRouter } from './layby.routes.js'
import { migrationRouter } from './migration.routes.js'
import { productsRouter } from './products.routes.js'
import { quotesRouter } from './quotes.routes.js'
import { rolesRouter } from './roles.routes.js'
import { supplierOffersRouter, suppliersRouter } from './suppliers.routes.js'
import { settingsRouter } from './settings.routes.js'
import { shiftsRouter } from './shifts.routes.js'
import { salesRouter } from './sales.routes.js'
import { storeCreditRouter } from './storeCredit.routes.js'
import { tabsRouter } from './tabs.routes.js'
import { usersRouter } from './users.routes.js'

export function apiRouter(accessSecret: string) {
  const requireAuth = buildRequireAuth(accessSecret)
  const r = Router()
  r.use('/auth', authRouter(requireAuth))
  r.use('/products', productsRouter(requireAuth))
  r.use('/suppliers', suppliersRouter(requireAuth))
  r.use('/supplier-offers', supplierOffersRouter(requireAuth))
  r.use('/sales', salesRouter(requireAuth))
  r.use('/shifts', shiftsRouter(requireAuth))
  r.use('/tabs', tabsRouter(requireAuth))
  r.use('/financials', financialsRouter(requireAuth))
  r.use('/settings', settingsRouter(requireAuth))
  r.use('/store-credit', storeCreditRouter(requireAuth))
  r.use('/house-accounts', houseAccountsRouter(requireAuth))
  r.use('/lay-bys', laybyRouter(requireAuth))
  r.use('/quotes', quotesRouter(requireAuth))
  r.use('/migration', migrationRouter(requireAuth))
  r.use('/users', usersRouter(requireAuth))
  r.use('/roles', rolesRouter(requireAuth))
  return r
}
