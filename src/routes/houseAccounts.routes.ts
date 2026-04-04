import { Router, type RequestHandler } from 'express'
import {
  createHouseAccount,
  getHouseAccount,
  listHouseAccountLedger,
  recordHouseAccountPayment,
  searchHouseAccounts,
  updateHouseAccount,
} from '../controllers/houseAccounts.controller.js'

export function houseAccountsRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, searchHouseAccounts)
  r.post('/', requireAuth, requireAdmin, createHouseAccount)
  r.get('/:id/ledger', requireAuth, listHouseAccountLedger)
  r.post('/:id/payments', requireAuth, recordHouseAccountPayment)
  r.get('/:id', requireAuth, getHouseAccount)
  r.patch('/:id', requireAuth, requireAdmin, updateHouseAccount)
  return r
}
