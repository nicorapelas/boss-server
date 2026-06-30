import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createHouseAccount,
  getHouseAccount,
  getHouseAccountStatement,
  listHouseAccountLedger,
  recordHouseAccountPayment,
  searchHouseAccounts,
  updateHouseAccount,
} from '../controllers/houseAccounts.controller.js'

export function houseAccountsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requirePermission('house_accounts.access'), searchHouseAccounts)
  r.post('/', requireAuth, requirePermission('house_accounts.access'), createHouseAccount)
  r.get('/:id', requireAuth, requirePermission('house_accounts.access'), getHouseAccount)
  r.patch('/:id', requireAuth, requirePermission('house_accounts.access'), updateHouseAccount)
  r.post('/:id/payments', requireAuth, requirePermission('house_accounts.access'), recordHouseAccountPayment)
  r.get('/:id/ledger', requireAuth, requirePermission('house_accounts.access'), listHouseAccountLedger)
  r.get('/:id/statement', requireAuth, requirePermission('house_accounts.access'), getHouseAccountStatement)
  return r
}
