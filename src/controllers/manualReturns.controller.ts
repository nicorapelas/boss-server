import type { NextFunction, Request, Response } from 'express'
import { createManualReturn } from '../services/manualReturn.service.js'

type ManualReturnBody = {
  tillCode?: string
  note?: string
  payoutMethod?: string
  storeCreditPhone?: string
  lines?: Array<{ productId?: string; quantity?: number }>
}

export async function postManualReturn(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const body = (req.body ?? {}) as ManualReturnBody
    const payoutRaw = typeof body.payoutMethod === 'string' ? body.payoutMethod.trim().toLowerCase() : ''
    const payoutMethod =
      payoutRaw === 'cash' || payoutRaw === 'card' || payoutRaw === 'store_credit' ? payoutRaw : null
    if (!payoutMethod) {
      res.status(400).json({ message: 'payoutMethod must be cash, card, or store_credit' })
      return
    }

    const result = await createManualReturn({
      tillCode: typeof body.tillCode === 'string' ? body.tillCode : undefined,
      note: typeof body.note === 'string' ? body.note : '',
      payoutMethod,
      storeCreditPhone: typeof body.storeCreditPhone === 'string' ? body.storeCreditPhone : undefined,
      lines: (body.lines ?? []).map((l) => ({
        productId: String(l.productId ?? ''),
        quantity: Number(l.quantity ?? 0),
      })),
      processedByUserId: String(req.user.id),
    })

    res.status(201).json({
      message: 'Manual return recorded',
      manualReturn: result,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Manual return failed'
    if (
      msg.includes('required') ||
      msg.includes('must be') ||
      msg.includes('not found') ||
      msg.includes('Invalid')
    ) {
      res.status(400).json({ message: msg })
      return
    }
    next(e)
  }
}
