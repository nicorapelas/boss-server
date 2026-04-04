import { Router, type RequestHandler } from 'express'
import { cancelQuote, createQuote, getQuote, listQuotes } from '../controllers/quotes.controller.js'

export function quotesRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, listQuotes)
  r.post('/', requireAuth, createQuote)
  r.get('/:id', requireAuth, getQuote)
  r.patch('/:id/cancel', requireAuth, cancelQuote)
  return r
}
