import type { Request, Response, NextFunction } from 'express'
import type { Types } from 'mongoose'
import { reservedQtyByProduct } from './layby.controller.js'
import { Product } from '../models/Product.js'
import { deleteProductPhotoFile } from '../utils/productPhotoPaths.js'
import { productTracksInventory } from '../utils/productInventory.js'
import { canonicalizeSku } from '../utils/skuNormalize.js'
import { bumpCatalogRevision } from '../services/catalogRevision.js'
import {
  listStockAdjustmentsForProduct as fetchStockAdjustmentsForProduct,
  recordStockAdjustment,
} from '../services/stockAdjustmentLog.service.js'
import { validateVolumeTiers } from '../utils/volumePrice.js'

const STOCK_ADJUSTMENT_LIST_DEFAULT = 30
const STOCK_ADJUSTMENT_LIST_MAX = 100

const SCAN_SEARCH_MAX_LIMIT = 50

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type ProductLean = {
  _id: unknown
  stock?: number
  trackInventory?: boolean
  photoRevision?: number
  [key: string]: unknown
}

async function enrichProductsWithAvailability(items: ProductLean[]) {
  const reserved = await reservedQtyByProduct()
  return items.map((p) => {
    const id = String(p._id)
    const pr = p.photoRevision ?? 0
    const base = {
      ...p,
      hasPhoto: pr > 0,
    }
    if (!productTracksInventory(p)) {
      return {
        ...base,
        layByReservedQty: 0,
        availableQty: null as number | null,
      }
    }
    const r = reserved.get(id) ?? 0
    const stock = p.stock ?? 0
    return {
      ...base,
      layByReservedQty: r,
      availableQty: stock - r,
    }
  })
}

async function enrichOneProductWithAvailability(p: ProductLean) {
  const [row] = await enrichProductsWithAvailability([p])
  return row
}

/** CogniPOS Scan — text search (SKU, barcode, name); does not return full catalog. */
export async function searchProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    let limit = Number(req.query.limit)
    if (!Number.isFinite(limit) || limit < 1) limit = 30
    limit = Math.min(Math.floor(limit), SCAN_SEARCH_MAX_LIMIT)
    if (!q) {
      res.json([])
      return
    }
    const rx = new RegExp(escapeRegex(q), 'i')
    const skuCanon = canonicalizeSku(q)
    const or: Record<string, unknown>[] = [{ name: rx }, { sku: rx }, { barcode: rx }]
    if (skuCanon && skuCanon !== q) {
      or.push({ sku: new RegExp(`^${escapeRegex(skuCanon)}`, 'i') })
    }
    const items = await Product.find({ $or: or })
      .sort({ sku: 1, name: 1 })
      .limit(limit)
      .lean()
    res.json(await enrichProductsWithAvailability(items as ProductLean[]))
  } catch (e) {
    next(e)
  }
}

/** CogniPOS Scan — exact SKU or barcode match (scanner wedge / lookup before search). */
export async function lookupProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const skuRaw = typeof req.query.sku === 'string' ? req.query.sku.trim() : ''
    const barcodeRaw = typeof req.query.barcode === 'string' ? req.query.barcode.trim() : ''
    if ((skuRaw && barcodeRaw) || (!skuRaw && !barcodeRaw)) {
      res.status(400).json({ message: 'Provide exactly one of sku or barcode' })
      return
    }

    let p: ProductLean | null = null

    if (skuRaw) {
      const normalized = canonicalizeSku(skuRaw)
      if (normalized) {
        p = (await Product.findOne({ sku: normalized }).lean()) as ProductLean | null
      }
      if (!p && normalized !== skuRaw) {
        p = (await Product.findOne({ sku: skuRaw }).lean()) as ProductLean | null
      }
      if (!p) {
        const pattern = `^${escapeRegex(skuRaw)}$`
        p = (await Product.findOne({ sku: { $regex: pattern, $options: 'i' } }).lean()) as ProductLean | null
      }
    } else {
      const digits = barcodeRaw.replace(/\D/g, '')
      p = (await Product.findOne({ barcode: barcodeRaw }).lean()) as ProductLean | null
      if (!p && digits && digits !== barcodeRaw) {
        p = (await Product.findOne({ barcode: digits }).lean()) as ProductLean | null
      }
      if (!p && digits) {
        const pattern = `^${escapeRegex(digits)}$`
        p = (await Product.findOne({
          barcode: { $regex: pattern, $options: 'i' },
        }).lean()) as ProductLean | null
      }
    }

    if (!p) {
      res.status(404).json({ message: 'Product not found' })
      return
    }

    res.json(await enrichOneProductWithAvailability(p))
  } catch (e) {
    next(e)
  }
}

export async function listProducts(_req: Request, res: Response, next: NextFunction) {
  try {
    const items = await Product.aggregate([
      {
        $addFields: {
          _skuMainStr: {
            $arrayElemAt: [{ $split: ['$sku', '-'] }, 0],
          },
          _skuTypeStr: {
            $ifNull: [{ $arrayElemAt: [{ $split: ['$sku', '-'] }, 1] }, '0'],
          },
        },
      },
      {
        $addFields: {
          _skuMainNum: {
            $cond: [
              { $regexMatch: { input: '$_skuMainStr', regex: '^[0-9]+$' } },
              { $toInt: '$_skuMainStr' },
              2147483647,
            ],
          },
          _skuTypeNum: {
            $cond: [
              { $regexMatch: { input: '$_skuTypeStr', regex: '^[0-9]+$' } },
              { $toInt: '$_skuTypeStr' },
              0,
            ],
          },
        },
      },
      { $sort: { _skuMainNum: 1, _skuTypeNum: 1, sku: 1, name: 1 } },
      { $project: { _skuMainStr: 0, _skuTypeStr: 0, _skuMainNum: 0, _skuTypeNum: 0 } },
    ])
    res.json(await enrichProductsWithAvailability(items as ProductLean[]))
  } catch (e) {
    next(e)
  }
}

export async function getProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const p = await Product.findById(req.params.id).lean()
    if (!p) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    res.json(await enrichOneProductWithAvailability(p as ProductLean))
  } catch (e) {
    next(e)
  }
}

export async function listProductStockAdjustments(req: Request, res: Response, next: NextFunction) {
  try {
    const p = await Product.findById(req.params.id).select('_id').lean()
    if (!p) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    let limit = Number(req.query.limit)
    if (!Number.isFinite(limit) || limit < 1) limit = STOCK_ADJUSTMENT_LIST_DEFAULT
    limit = Math.min(Math.floor(limit), STOCK_ADJUSTMENT_LIST_MAX)
    const items = await fetchStockAdjustmentsForProduct(req.params.id, limit)
    res.json(items)
  } catch (e) {
    next(e)
  }
}

export async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      name,
      sku,
      category,
      subCategory,
      barcode,
      price,
      stock,
      trackInventory,
      volumeTieringEnabled,
      volumeTiers,
      jobCardLabourPerUnit,
    } = req.body as {
      name?: string
      sku?: string
      category?: string | null
      subCategory?: string | null
      barcode?: string | null
      price?: number
      stock?: number
      trackInventory?: boolean
      volumeTieringEnabled?: boolean
      volumeTiers?: unknown
      jobCardLabourPerUnit?: unknown
    }
    if (!name || !sku || price === undefined) {
      res.status(400).json({ message: 'name, sku, and price required' })
      return
    }
    const normalizedSku = canonicalizeSku(sku)
    if (!normalizedSku) {
      res.status(400).json({ message: 'sku required' })
      return
    }
    const vol = Boolean(volumeTieringEnabled)
    const v = validateVolumeTiers(Number(price), vol, volumeTiers)
    if (!v.ok) {
      res.status(400).json({ message: v.message })
      return
    }
    const cat = category?.trim() ? category.trim() : null
    const sub = cat && subCategory?.trim() ? subCategory.trim() : null
    let labour: number | undefined
    if (jobCardLabourPerUnit !== undefined && jobCardLabourPerUnit !== null && jobCardLabourPerUnit !== '') {
      const n = Number(jobCardLabourPerUnit)
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ message: 'jobCardLabourPerUnit must be a non-negative number' })
        return
      }
      const rounded = Math.round(n * 100) / 100
      labour = rounded > 0.0001 ? rounded : undefined
    }
    const initialStock = stock ?? 0
    const product = await Product.create({
      name,
      sku: normalizedSku,
      category: cat,
      subCategory: sub,
      barcode: barcode ?? null,
      price,
      stock: initialStock,
      trackInventory: trackInventory !== false,
      volumeTieringEnabled: vol,
      volumeTiers: v.tiers,
      ...(labour !== undefined ? { jobCardLabourPerUnit: labour } : {}),
    })
    if (initialStock !== 0) {
      await recordStockAdjustment({
        req,
        productId: product._id,
        productSku: normalizedSku,
        fromStock: 0,
        toStock: initialStock,
      })
    }
    res.status(201).json(product)
  } catch (e) {
    next(e)
  }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      name,
      sku,
      category,
      subCategory,
      barcode,
      price,
      stock,
      trackInventory,
      volumeTieringEnabled,
      volumeTiers,
      jobCardLabourPerUnit,
    } = req.body as {
      name?: string
      sku?: string
      category?: string | null
      subCategory?: string | null
      barcode?: string | null
      price?: number
      stock?: number
      trackInventory?: boolean
      volumeTieringEnabled?: boolean
      volumeTiers?: unknown
      jobCardLabourPerUnit?: unknown
    }
    const $set: Record<string, unknown> = {}
    if (name !== undefined) $set.name = name
    if (sku !== undefined) {
      const normalizedSku = canonicalizeSku(sku)
      if (!normalizedSku) {
        res.status(400).json({ message: 'sku required' })
        return
      }
      $set.sku = normalizedSku
    }
    const catIn = category !== undefined ? (category?.trim() ? category.trim() : null) : undefined
    const subIn = subCategory !== undefined ? (subCategory?.trim() ? subCategory.trim() : null) : undefined
    if (catIn !== undefined) {
      $set.category = catIn
      if (!catIn) $set.subCategory = null
    }
    if (subIn !== undefined && !(catIn !== undefined && !catIn)) {
      $set.subCategory = subIn
    }
    if (barcode !== undefined) $set.barcode = barcode
    if (price !== undefined) $set.price = price
    if (stock !== undefined) $set.stock = stock
    if (trackInventory !== undefined) $set.trackInventory = Boolean(trackInventory)
    if (jobCardLabourPerUnit !== undefined) {
      if (jobCardLabourPerUnit === null || jobCardLabourPerUnit === '') {
        $set.jobCardLabourPerUnit = 0
      } else {
        const n = Number(jobCardLabourPerUnit)
        if (!Number.isFinite(n) || n < 0) {
          res.status(400).json({ message: 'jobCardLabourPerUnit must be a non-negative number' })
          return
        }
        $set.jobCardLabourPerUnit = Math.round(n * 100) / 100
      }
    }
    if (Object.keys($set).length === 0) {
      res.status(400).json({ message: 'No fields to update' })
      return
    }

    const needsExisting =
      stock !== undefined ||
      price !== undefined ||
      volumeTieringEnabled !== undefined ||
      volumeTiers !== undefined
    let existing: ProductLean | null = null
    if (needsExisting) {
      existing = (await Product.findById(req.params.id).lean()) as ProductLean | null
      if (!existing) {
        res.status(404).json({ message: 'Product not found' })
        return
      }
    }

    if (
      price !== undefined ||
      volumeTieringEnabled !== undefined ||
      volumeTiers !== undefined
    ) {
      const nextPrice = price !== undefined ? Number(price) : Number(existing!.price ?? 0)
      const nextVol =
        volumeTieringEnabled !== undefined
          ? Boolean(volumeTieringEnabled)
          : Boolean(existing!.volumeTieringEnabled)
      const nextTiersRaw = volumeTiers !== undefined ? volumeTiers : existing!.volumeTiers
      const v = validateVolumeTiers(nextPrice, nextVol, nextTiersRaw)
      if (!v.ok) {
        res.status(400).json({ message: v.message })
        return
      }
      $set.volumeTieringEnabled = nextVol
      $set.volumeTiers = v.tiers
    }

    if (stock !== undefined && existing) {
      const fromStock = Number(existing.stock ?? 0)
      const toStock = Math.floor(Number(stock)) || 0
      await recordStockAdjustment({
        req,
        productId: existing._id as Types.ObjectId,
        productSku: String(existing.sku ?? ''),
        fromStock,
        toStock,
      })
    }

    const product = await Product.findByIdAndUpdate(req.params.id, { $set }, { new: true, runValidators: true }).lean()
    if (!product) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    await bumpCatalogRevision()
    res.json(await enrichOneProductWithAvailability(product as ProductLean))
  } catch (e) {
    next(e)
  }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    const p = await Product.findByIdAndDelete(id)
    if (!p) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    await deleteProductPhotoFile(id)
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
