import type { Request } from 'express'
import type { Types } from 'mongoose'
import { StockAdjustmentLog } from '../models/StockAdjustmentLog.js'
import { User } from '../models/User.js'
import { parseClientAppHeader } from '../utils/clientAppHeader.js'

type RecordStockAdjustmentInput = {
  req: Request
  productId: Types.ObjectId | string
  productSku: string
  fromStock: number
  toStock: number
}

export async function recordStockAdjustment(input: RecordStockAdjustmentInput): Promise<void> {
  const { req, productId, productSku, fromStock, toStock } = input
  const user = req.user
  if (!user) return

  const from = Math.floor(Number(fromStock)) || 0
  const to = Math.floor(Number(toStock)) || 0
  if (from === to) return

  let displayName: string | null | undefined
  try {
    const row = await User.findById(user.id).select('displayName').lean()
    displayName = row?.displayName?.trim() || null
  } catch {
    displayName = null
  }

  await StockAdjustmentLog.create({
    productId,
    productSku,
    fromStock: from,
    toStock: to,
    delta: to - from,
    changedBy: user.id,
    changedByEmail: user.email,
    changedByDisplayName: displayName,
    sourceApp: parseClientAppHeader(req),
  })
}

export async function listStockAdjustmentsForProduct(
  productId: string,
  limit: number,
): Promise<
  Array<{
    _id: unknown
    productId: unknown
    productSku: string
    fromStock: number
    toStock: number
    delta: number
    changedByEmail: string
    changedByDisplayName?: string | null
    sourceApp: string
    createdAt?: Date
  }>
> {
  return StockAdjustmentLog.find({ productId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
}
