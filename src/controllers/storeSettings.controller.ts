import type { NextFunction, Request, Response } from 'express'
import { StoreSettings } from '../models/StoreSettings.js'

const DEFAULT_DOC = {
  _id: 'default' as const,
  storeName: 'ElectroPOS',
  storeAddressLines: [] as string[],
  storePhone: '',
  storeVatNumber: '',
  layByTerms: '',
  defaultDepositPercent: 30,
  defaultExpiryMonths: 3,
  vatRate: 0.14,
  nextLayBySeq: 1,
  nextQuoteSeq: 0,
  nextHouseAccountSeq: 0,
}

export async function getStoreSettings(_req: Request, res: Response, next: NextFunction) {
  try {
    let doc = await StoreSettings.findById('default').lean()
    if (!doc) {
      await StoreSettings.create(DEFAULT_DOC)
      doc = await StoreSettings.findById('default').lean()
    }
    res.json(doc)
  } catch (e) {
    next(e)
  }
}

export async function updateStoreSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as Partial<{
      storeName: string
      storeAddressLines: string[]
      storePhone: string
      storeVatNumber: string
      layByTerms: string
      defaultDepositPercent: number
      defaultExpiryMonths: number
      vatRate: number
    }>
    const set: Record<string, unknown> = {}
    if (body.storeName !== undefined) set.storeName = String(body.storeName).trim()
    if (body.storeAddressLines !== undefined) set.storeAddressLines = body.storeAddressLines
    if (body.storePhone !== undefined) set.storePhone = String(body.storePhone).trim()
    if (body.storeVatNumber !== undefined) set.storeVatNumber = String(body.storeVatNumber).trim()
    if (body.layByTerms !== undefined) set.layByTerms = String(body.layByTerms)
    if (body.defaultDepositPercent !== undefined) {
      const n = Number(body.defaultDepositPercent)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        res.status(400).json({ message: 'defaultDepositPercent must be 0–100' })
        return
      }
      set.defaultDepositPercent = n
    }
    if (body.defaultExpiryMonths !== undefined) {
      const n = Number(body.defaultExpiryMonths)
      if (!Number.isFinite(n) || n < 1 || n > 120) {
        res.status(400).json({ message: 'defaultExpiryMonths must be 1–120' })
        return
      }
      set.defaultExpiryMonths = n
    }
    if (body.vatRate !== undefined) {
      const n = Number(body.vatRate)
      if (!Number.isFinite(n) || n < 0 || n > 0.5) {
        res.status(400).json({ message: 'vatRate must be between 0 and 0.5' })
        return
      }
      set.vatRate = n
    }
    const updated = await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: set },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    res.json(updated)
  } catch (e) {
    next(e)
  }
}
