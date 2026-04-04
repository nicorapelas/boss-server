import type { NextFunction, Request, Response } from 'express'
import { StoreSettings } from '../models/StoreSettings.js'
import { ensureStoreSettingsDoc } from './storeSettings.controller.js'
import { mergeDefaultProductPresets, normalizeProductPresetsPayload } from '../utils/productPresets.js'

export async function getProductPresets(_req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ensureStoreSettingsDoc()
    if (!doc) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json(mergeDefaultProductPresets(doc.productPresets))
  } catch (e) {
    next(e)
  }
}

export async function putProductPresets(req: Request, res: Response, next: NextFunction) {
  try {
    const normalized = normalizeProductPresetsPayload(req.body)
    await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: { productPresets: normalized } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    res.json(normalized)
  } catch (e) {
    next(e)
  }
}
