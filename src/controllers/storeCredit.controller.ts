import type { Request, Response, NextFunction } from 'express'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** Balance lookup for POS checkout (same digits-only phone key as accounts). */
export async function getStoreCreditBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const phone = normalizePhone(String(req.query.phone ?? ''))
    if (!phone) {
      res.status(400).json({ message: 'phone query required' })
      return
    }
    const acct = await StoreCreditAccount.findOne({ phone }).lean()
    res.json({ balance: acct?.balance ?? 0, name: acct?.name ?? '' })
  } catch (e) {
    next(e)
  }
}

export async function listStoreCreditAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 1000)
    const list = await StoreCreditAccount.find().sort({ balance: -1, phone: 1 }).limit(limit).lean()
    res.json(list)
  } catch (e) {
    next(e)
  }
}

export async function listStoreCreditLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500)
    const list = await StoreCreditLedger.find().sort({ createdAt: -1 }).limit(limit).lean()
    res.json(list)
  } catch (e) {
    next(e)
  }
}
