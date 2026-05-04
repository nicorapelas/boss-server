import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  getStoreCreditBalance,
  listStoreCreditAccounts,
  listStoreCreditLedger,
} from '../controllers/storeCredit.controller.js'

export function storeCreditRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/balance', requireAuth, requirePermission('sales.create'), getStoreCreditBalance)
  r.get('/accounts', requireAuth, requirePermission('store_credit.access'), listStoreCreditAccounts)
  r.get('/ledger', requireAuth, requirePermission('store_credit.access'), listStoreCreditLedger)
  return r
}
