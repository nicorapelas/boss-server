import { Router, type RequestHandler } from 'express'
import { requireAnyPermission } from '../middleware/requireAnyPermission.middleware.js'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  adjustLoyaltyPoints,
  changeLoyaltyPhone,
  getLoyaltyMember,
  getLoyaltyMemberPurchases,
  getLoyaltyProgram,
  listLoyaltyMembers,
  listLoyaltyPhoneChanges,
  lookupLoyalty,
} from '../controllers/loyalty.controller.js'

export function loyaltyRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/program', requireAuth, getLoyaltyProgram)
  r.get('/lookup', requireAuth, requirePermission('sales.create'), lookupLoyalty)
  r.get('/members', requireAuth, requirePermission('loyalty.access'), listLoyaltyMembers)
  r.get('/members/:id', requireAuth, requirePermission('loyalty.access'), getLoyaltyMember)
  r.get(
    '/members/:id/purchases',
    requireAuth,
    requireAnyPermission('loyalty.access', 'sales.create'),
    getLoyaltyMemberPurchases,
  )
  r.post('/members/:id/adjust', requireAuth, requirePermission('loyalty.admin'), adjustLoyaltyPoints)
  r.post('/change-phone', requireAuth, requirePermission('loyalty.admin'), changeLoyaltyPhone)
  r.get('/phone-changes', requireAuth, requirePermission('loyalty.admin'), listLoyaltyPhoneChanges)
  return r
}
