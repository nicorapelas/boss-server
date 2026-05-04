import type { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import { Product } from '../models/Product.js'
import { Supplier } from '../models/Supplier.js'
import { SupplierOffer } from '../models/SupplierOffer.js'

function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : ''
}

function parseOptionalString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

async function clearPreferredExcept(productId: mongoose.Types.ObjectId, exceptId: mongoose.Types.ObjectId | null) {
  const q: Record<string, unknown> = { product: productId, preferred: true }
  if (exceptId) q._id = { $ne: exceptId }
  await SupplierOffer.updateMany(q, { $set: { preferred: false } })
}

export async function listSuppliers(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await Supplier.find().sort({ name: 1 }).lean()
    res.json(rows)
  } catch (e) {
    next(e)
  }
}

export async function getSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const s = await Supplier.findById(req.params.id).lean()
    if (!s) {
      res.status(404).json({ message: 'Supplier not found' })
      return
    }
    res.json(s)
  } catch (e) {
    next(e)
  }
}

export async function createSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const code = normalizeCode(body.code)
    if (!name || !code) {
      res.status(400).json({ message: 'name and code required' })
      return
    }
    const row = await Supplier.create({
      name,
      code,
      active: body.active !== false,
      contactName: parseOptionalString(body.contactName),
      email: parseOptionalString(body.email),
      phone: parseOptionalString(body.phone),
      accountNumber: parseOptionalString(body.accountNumber),
      notes: parseOptionalString(body.notes),
    })
    res.status(201).json(row)
  } catch (e) {
    next(e)
  }
}

export async function updateSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as Record<string, unknown>
    const $set: Record<string, unknown> = {}
    if (typeof body.name === 'string') $set.name = body.name.trim()
    if (body.code !== undefined) $set.code = normalizeCode(body.code)
    if (body.active !== undefined) $set.active = Boolean(body.active)
    if (body.contactName !== undefined) $set.contactName = parseOptionalString(body.contactName)
    if (body.email !== undefined) $set.email = parseOptionalString(body.email)
    if (body.phone !== undefined) $set.phone = parseOptionalString(body.phone)
    if (body.accountNumber !== undefined) $set.accountNumber = parseOptionalString(body.accountNumber)
    if (body.notes !== undefined) $set.notes = parseOptionalString(body.notes)

    if (Object.keys($set).length === 0) {
      res.status(400).json({ message: 'No fields to update' })
      return
    }
    if ($set.code === '') {
      res.status(400).json({ message: 'code cannot be empty' })
      return
    }

    const row = await Supplier.findByIdAndUpdate(req.params.id, { $set }, { new: true, runValidators: true })
    if (!row) {
      res.status(404).json({ message: 'Supplier not found' })
      return
    }
    res.json(row)
  } catch (e) {
    next(e)
  }
}

export async function deleteSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    const count = await SupplierOffer.countDocuments({ supplier: id })
    if (count > 0) {
      res.status(409).json({ message: `Cannot delete supplier with ${count} catalog offer(s); remove offers first.` })
      return
    }
    const s = await Supplier.findByIdAndDelete(id)
    if (!s) {
      res.status(404).json({ message: 'Supplier not found' })
      return
    }
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}

/** Offers for one supplier (with product name/sku). */
function offerProductName(o: { product?: unknown }): string {
  const p = o.product
  if (p && typeof p === 'object' && 'name' in p && typeof (p as { name?: unknown }).name === 'string') {
    return (p as { name: string }).name
  }
  return ''
}

export async function listOffersForSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const supplierId = req.params.supplierId
    const rows = await SupplierOffer.find({ supplier: supplierId }).populate('product', 'name sku').lean()
    rows.sort((a, b) =>
      offerProductName(a).localeCompare(offerProductName(b), undefined, { sensitivity: 'base' }),
    )
    res.json(rows)
  } catch (e) {
    next(e)
  }
}

/** Offers for one product (with supplier name/code) — price comparison. */
export async function listOffersForProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = typeof req.query.productId === 'string' ? req.query.productId.trim() : ''
    if (!productId || !mongoose.isValidObjectId(productId)) {
      res.status(400).json({ message: 'productId query required' })
      return
    }
    const rows = await SupplierOffer.find({ product: productId })
      .populate('supplier', 'name code active')
      .sort({ unitCost: 1 })
      .lean()
    res.json(rows)
  } catch (e) {
    next(e)
  }
}

export async function createSupplierOffer(req: Request, res: Response, next: NextFunction) {
  try {
    const supplierId = req.params.supplierId
    if (!mongoose.isValidObjectId(supplierId)) {
      res.status(400).json({ message: 'Invalid supplier id' })
      return
    }
    const supplier = await Supplier.findById(supplierId).lean()
    if (!supplier) {
      res.status(404).json({ message: 'Supplier not found' })
      return
    }

    const body = req.body as Record<string, unknown>
    const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
    if (!productId || !mongoose.isValidObjectId(productId)) {
      res.status(400).json({ message: 'productId required' })
      return
    }
    const product = await Product.findById(productId).lean()
    if (!product) {
      res.status(404).json({ message: 'Product not found' })
      return
    }

    const unitCost = Number(body.unitCost)
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      res.status(400).json({ message: 'unitCost must be a number ≥ 0' })
      return
    }
    const unitsPerPack = Math.max(1, Math.floor(Number(body.unitsPerPack) || 1))
    const minOrderQty = Math.max(1, Math.floor(Number(body.minOrderQty) || 1))
    const leadRaw = body.leadTimeDays
    let leadTimeDays: number | null = null
    if (leadRaw !== null && leadRaw !== undefined && leadRaw !== '') {
      const n = Number(leadRaw)
      leadTimeDays = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null
    }
    const preferred = Boolean(body.preferred)
    let priceEffectiveDate: Date | null = null
    if (typeof body.priceEffectiveDate === 'string' && body.priceEffectiveDate.trim()) {
      const d = new Date(body.priceEffectiveDate)
      if (!Number.isNaN(d.getTime())) priceEffectiveDate = d
    }

    const dup = await SupplierOffer.findOne({ supplier: supplierId, product: productId }).lean()
    if (dup) {
      res.status(409).json({ message: 'An offer already exists for this product from this supplier' })
      return
    }

    const productOid = new mongoose.Types.ObjectId(productId)
    if (preferred) {
      await clearPreferredExcept(productOid, null)
    }

    const row = await SupplierOffer.create({
      product: productOid,
      supplier: new mongoose.Types.ObjectId(supplierId),
      supplierSku: parseOptionalString(body.supplierSku),
      unitCost,
      unitsPerPack,
      minOrderQty,
      leadTimeDays,
      preferred,
      priceEffectiveDate,
    })
    const populated = await SupplierOffer.findById(row._id).populate('product', 'name sku').lean()
    res.status(201).json(populated)
  } catch (e) {
    next(e)
  }
}

export async function updateSupplierOffer(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    const existing = await SupplierOffer.findById(id).lean()
    if (!existing) {
      res.status(404).json({ message: 'Offer not found' })
      return
    }

    const body = req.body as Record<string, unknown>
    const $set: Record<string, unknown> = {}

    if (body.supplierSku !== undefined) $set.supplierSku = parseOptionalString(body.supplierSku)
    if (body.unitCost !== undefined) {
      const unitCost = Number(body.unitCost)
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        res.status(400).json({ message: 'unitCost must be a number ≥ 0' })
        return
      }
      $set.unitCost = unitCost
    }
    if (body.unitsPerPack !== undefined) {
      const u = Math.max(1, Math.floor(Number(body.unitsPerPack) || 1))
      $set.unitsPerPack = u
    }
    if (body.minOrderQty !== undefined) {
      const m = Math.max(1, Math.floor(Number(body.minOrderQty) || 1))
      $set.minOrderQty = m
    }
    if (body.leadTimeDays !== undefined) {
      const leadRaw = body.leadTimeDays
      if (leadRaw === null || leadRaw === '') {
        $set.leadTimeDays = null
      } else {
        const n = Number(leadRaw)
        $set.leadTimeDays = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null
      }
    }
    if (body.priceEffectiveDate !== undefined) {
      if (body.priceEffectiveDate === null || body.priceEffectiveDate === '') {
        $set.priceEffectiveDate = null
      } else if (typeof body.priceEffectiveDate === 'string') {
        const d = new Date(body.priceEffectiveDate)
        $set.priceEffectiveDate = Number.isNaN(d.getTime()) ? null : d
      }
    }

    const nextPreferred =
      body.preferred !== undefined ? Boolean(body.preferred) : Boolean(existing.preferred)
    if (body.preferred !== undefined) $set.preferred = nextPreferred

    if (Object.keys($set).length === 0) {
      res.status(400).json({ message: 'No fields to update' })
      return
    }

    if (nextPreferred) {
      await clearPreferredExcept(
        existing.product as mongoose.Types.ObjectId,
        new mongoose.Types.ObjectId(id),
      )
    }

    const row = await SupplierOffer.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true })
      .populate('product', 'name sku')
      .populate('supplier', 'name code')
      .lean()
    res.json(row)
  } catch (e) {
    next(e)
  }
}

export async function deleteSupplierOffer(req: Request, res: Response, next: NextFunction) {
  try {
    const o = await SupplierOffer.findByIdAndDelete(req.params.id)
    if (!o) {
      res.status(404).json({ message: 'Offer not found' })
      return
    }
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
