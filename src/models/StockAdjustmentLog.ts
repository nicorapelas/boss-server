import mongoose, { Schema, Types } from 'mongoose'
import type { ClientAppSource } from '../utils/clientAppHeader.js'

export interface IStockAdjustmentLog {
  productId: Types.ObjectId
  productSku: string
  fromStock: number
  toStock: number
  delta: number
  changedBy: Types.ObjectId
  changedByEmail: string
  changedByDisplayName?: string | null
  sourceApp: ClientAppSource
}

const stockAdjustmentLogSchema = new Schema<IStockAdjustmentLog>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    productSku: { type: String, required: true, trim: true },
    fromStock: { type: Number, required: true },
    toStock: { type: Number, required: true },
    delta: { type: Number, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    changedByEmail: { type: String, required: true, trim: true, lowercase: true },
    changedByDisplayName: { type: String, trim: true, default: null },
    sourceApp: {
      type: String,
      enum: ['shop-assist', 'back-office', 'pos', 'scan', 'unknown'],
      default: 'unknown',
      index: true,
    },
  },
  { timestamps: true },
)

stockAdjustmentLogSchema.index({ productId: 1, createdAt: -1 })

export const StockAdjustmentLog = mongoose.model<IStockAdjustmentLog>(
  'StockAdjustmentLog',
  stockAdjustmentLogSchema,
)
