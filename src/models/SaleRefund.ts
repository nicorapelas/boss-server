import mongoose, { Schema, Types } from 'mongoose'

export interface ISaleRefundLine {
  saleLineIndex: number
  product?: Types.ObjectId
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface ISaleRefund {
  saleId: Types.ObjectId
  saleShortId?: string
  tillCode?: string
  payoutMethod: 'cash' | 'card' | 'store_credit'
  note?: string
  lines: ISaleRefundLine[]
  refundTotal: number
  refundCash: number
  refundCard: number
  /** Amount newly credited when payout is store_credit (cash/card portion of refund). */
  refundStoreCreditIssued?: number
  /** Phone key used for refundStoreCreditIssued (digits only). */
  storeCreditPhone?: string
  reversedStoreCredit?: number
  reversedOnAccount?: number
  refundedBy: Types.ObjectId
}

const saleRefundLineSchema = new Schema<ISaleRefundLine>(
  {
    saleLineIndex: { type: Number, required: true, min: 0 },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const saleRefundSchema = new Schema<ISaleRefund>(
  {
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
    saleShortId: { type: String, trim: true, index: true },
    tillCode: { type: String, trim: true, index: true },
    payoutMethod: { type: String, enum: ['cash', 'card', 'store_credit'], required: true },
    note: { type: String, trim: true },
    lines: { type: [saleRefundLineSchema], required: true },
    refundTotal: { type: Number, required: true, min: 0.01 },
    refundCash: { type: Number, required: true, min: 0, default: 0 },
    refundCard: { type: Number, required: true, min: 0, default: 0 },
    refundStoreCreditIssued: { type: Number, min: 0 },
    storeCreditPhone: { type: String, trim: true },
    reversedStoreCredit: { type: Number, min: 0, default: 0 },
    reversedOnAccount: { type: Number, min: 0, default: 0 },
    refundedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
)

export const SaleRefund = mongoose.model<ISaleRefund>('SaleRefund', saleRefundSchema)
