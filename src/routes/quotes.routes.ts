import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import { cancelQuote, createQuote, getQuote, listQuotes } from '../controllers/quotes.controller.js'

export function quotesRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requirePermission('quotes.use'), listQuotes)
  r.post('/', requireAuth, requirePermission('quotes.use'), createQuote)
  r.get('/:id', requireAuth, requirePermission('quotes.use'), getQuote)
  r.patch('/:id/cancel', requireAuth, requirePermission('quotes.use'), cancelQuote)
  return r
}
