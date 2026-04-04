import type { Request, Response, NextFunction } from 'express'
import { reservedQtyByProduct } from './layby.controller.js'
import { Product } from '../models/Product.js'

export async function listProducts(_req: Request, res: Response, next: NextFunction) {
  try {
    const reserved = await reservedQtyByProduct()
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
    const withLayBy = items.map((p: { _id: unknown; stock?: number }) => {
      const id = String(p._id)
      const r = reserved.get(id) ?? 0
      const stock = p.stock ?? 0
      return {
        ...p,
        layByReservedQty: r,
        availableQty: stock - r,
      }
    })
    res.json(withLayBy)
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
    res.json(p)
  } catch (e) {
    next(e)
  }
}

export async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, sku, barcode, price, stock } = req.body as {
      name?: string
      sku?: string
      barcode?: string | null
      price?: number
      stock?: number
    }
    if (!name || !sku || price === undefined) {
      res.status(400).json({ message: 'name, sku, and price required' })
      return
    }
    const product = await Product.create({
      name,
      sku,
      barcode: barcode ?? null,
      price,
      stock: stock ?? 0,
    })
    res.status(201).json(product)
  } catch (e) {
    next(e)
  }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, sku, barcode, price, stock } = req.body as {
      name?: string
      sku?: string
      barcode?: string | null
      price?: number
      stock?: number
    }
    const $set: Record<string, unknown> = {}
    if (name !== undefined) $set.name = name
    if (sku !== undefined) $set.sku = sku
    if (barcode !== undefined) $set.barcode = barcode
    if (price !== undefined) $set.price = price
    if (stock !== undefined) $set.stock = stock
    if (Object.keys($set).length === 0) {
      res.status(400).json({ message: 'No fields to update' })
      return
    }
    const product = await Product.findByIdAndUpdate(req.params.id, { $set }, { new: true, runValidators: true })
    if (!product) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    res.json(product)
  } catch (e) {
    next(e)
  }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const p = await Product.findByIdAndDelete(req.params.id)
    if (!p) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
