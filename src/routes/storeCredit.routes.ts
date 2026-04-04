import { Router, type RequestHandler } from 'express'
import { listStoreCreditAccounts, listStoreCreditLedger } from '../controllers/storeCredit.controller.js'

export function storeCreditRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/accounts', requireAuth, requireAdmin, listStoreCreditAccounts)
  r.get('/ledger', requireAuth, requireAdmin, listStoreCreditLedger)
  return r
}
