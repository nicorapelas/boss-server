import type { NextFunction, Request, Response } from 'express'
import { StoreSettings } from '../models/StoreSettings.js'
import { DEFAULT_STORE_NAME } from '../brand.js'
import { customerDisplayFromBody, mergeCustomerDisplay } from '../utils/customerDisplaySettings.js'
import { mergeDefaultProductPresets } from '../utils/productPresets.js'

export const DEFAULT_STORE_SETTINGS_DOC = {
  _id: 'default' as const,
  storeName: DEFAULT_STORE_NAME,
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
  nextJobCardSeq: 0,
  productPresets: {
    entries: [] as { productId: string; category: string; subCategory: string; label: string }[],
    categories: [] as string[],
    subCategoriesByCategory: {} as Record<string, string[]>,
  },
  customerDisplay: {
    enabled: true,
    idle: { headline: 'Welcome', subtext: '', imageUrl: '' },
    theme: { backgroundColor: '#0f1419', accentColor: '#3b82f6' },
    footerText: 'All prices include VAT',
  },
  catalogRevision: 0,
  catalogPushedAt: null as string | null,
}

function withMergedSettings(doc: {
  productPresets?: Parameters<typeof mergeDefaultProductPresets>[0]
  customerDisplay?: unknown
  [key: string]: unknown
}) {
  return {
    ...doc,
    productPresets: mergeDefaultProductPresets(doc.productPresets),
    customerDisplay: mergeCustomerDisplay(doc.customerDisplay),
  }
}

export async function ensureStoreSettingsDoc() {
  let doc = await StoreSettings.findById('default').lean()
  if (!doc) {
    await StoreSettings.create(DEFAULT_STORE_SETTINGS_DOC)
    doc = await StoreSettings.findById('default').lean()
  }
  return doc
}

export async function getStoreSettings(_req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ensureStoreSettingsDoc()
    if (!doc) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json(withMergedSettings(doc))
  } catch (e) {
    next(e)
  }
}

export async function getCatalogSync(_req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ensureStoreSettingsDoc()
    if (!doc) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json({
      catalogRevision: typeof doc.catalogRevision === 'number' ? doc.catalogRevision : 0,
      catalogPushedAt: doc.catalogPushedAt ?? null,
    })
  } catch (e) {
    next(e)
  }
}

export async function pushCatalogToTills(_req: Request, res: Response, next: NextFunction) {
  try {
    const catalogPushedAt = new Date().toISOString()
    const updated = await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $inc: { catalogRevision: 1 }, $set: { catalogPushedAt } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    if (!updated) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json({
      catalogRevision: typeof updated.catalogRevision === 'number' ? updated.catalogRevision : 1,
      catalogPushedAt,
    })
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
      customerDisplay: unknown
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
    const cd = customerDisplayFromBody(body.customerDisplay)
    if (cd) set.customerDisplay = cd
    const updated = await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: set },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    if (!updated) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json(withMergedSettings(updated))
  } catch (e) {
    next(e)
  }
}
