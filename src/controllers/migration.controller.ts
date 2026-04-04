import type { NextFunction, Request, Response } from 'express'
import { Product } from '../models/Product.js'
import { Sale } from '../models/Sale.js'
import { User } from '../models/User.js'

export async function migrationAudit(_req: Request, res: Response, next: NextFunction) {
  try {
    const [
      productsTotal,
      productsVector,
      productsNegativeStock,
      productsNoBarcode,
      usersTotal,
      usersVector,
      usersVectorLocked,
      salesTotal,
      salesVector,
      salesVectorNoCashier,
      salesAnyNoCashier,
      salesLineOrphansAgg,
      productsNoLegacyMapping,
      sampleOrphanSales,
      sampleNegativeStockProducts,
      sampleMissingBarcodeProducts,
      sampleLockedUsers,
    ] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ 'legacy.source': 'vector' }),
      Product.countDocuments({ stock: { $lt: 0 } }),
      Product.countDocuments({ 'legacy.source': 'vector', $or: [{ barcode: null }, { barcode: '' }] }),
      User.countDocuments(),
      User.countDocuments({ 'legacy.source': 'vector' }),
      User.countDocuments({ 'legacy.source': 'vector', 'legacy.canLogin': false }),
      Sale.countDocuments(),
      Sale.countDocuments({ 'legacy.source': 'vector' }),
      Sale.countDocuments({ 'legacy.source': 'vector', cashier: null }),
      Sale.countDocuments({ cashier: null }),
      Sale.aggregate([
        { $unwind: '$items' },
        {
          $match: {
            'items.product': { $in: [null] },
            'items.legacyItemNo': { $exists: true },
          },
        },
        { $count: 'count' },
      ]),
      Product.countDocuments({ 'legacy.source': { $ne: 'vector' } }),
      Sale.find({ 'legacy.source': 'vector', cashier: null })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('legacy total paymentMethod createdAt')
        .lean(),
      Product.find({ stock: { $lt: 0 } })
        .sort({ stock: 1, sku: 1 })
        .limit(200)
        .select('name sku barcode stock')
        .lean(),
      Product.find({
        'legacy.source': 'vector',
        $or: [{ barcode: null }, { barcode: '' }],
      })
        .sort({ sku: 1 })
        .limit(200)
        .select('name sku barcode stock')
        .lean(),
      User.find({ 'legacy.source': 'vector', 'legacy.canLogin': false })
        .sort({ 'legacy.userNo': 1 })
        .limit(100)
        .select('email displayName role legacy')
        .lean(),
    ])

    const salesLineOrphans = salesLineOrphansAgg[0]?.count ?? 0

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        productsTotal,
        productsVector,
        usersTotal,
        usersVector,
        salesTotal,
        salesVector,
      },
      issues: {
        productsNegativeStock,
        productsNoBarcode,
        productsNoLegacyMapping,
        usersVectorLocked,
        salesVectorNoCashier,
        salesAnyNoCashier,
        salesLineOrphans,
      },
      samples: {
        orphanCashierSales: sampleOrphanSales,
        negativeStockProducts: sampleNegativeStockProducts,
        missingBarcodeProducts: sampleMissingBarcodeProducts,
        lockedVectorUsers: sampleLockedUsers,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function fixNegativeStockToZero(_req: Request, res: Response, next: NextFunction) {
  try {
    const before = await Product.countDocuments({ stock: { $lt: 0 } })
    const result = await Product.updateMany(
      { stock: { $lt: 0 } },
      { $set: { stock: 0 } },
    )
    const after = await Product.countDocuments({ stock: { $lt: 0 } })

    res.json({
      before,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      after,
    })
  } catch (err) {
    next(err)
  }
}

