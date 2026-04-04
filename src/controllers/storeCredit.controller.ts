import type { Request, Response, NextFunction } from 'express'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'

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
