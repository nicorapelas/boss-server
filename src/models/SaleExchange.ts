import mongoose, { Schema, Types } from 'mongoose'

export interface ISaleExchangeReturnLine {
  saleLineIndex: number
  product?: Types.ObjectId
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface ISaleExchangeNewLine {
  product?: Types.ObjectId
  sku?: string
  name: string
  quantity: number
  unitPrice: number
  listUnitPrice?: number
  lineTotal: number
}

export type SaleExchangeSettlementKind =
  | 'even'
  | 'customer_pays_cash'
  | 'customer_receives_cash'
  | 'customer_receives_store_credit'

export interface ISaleExchange {
  saleId: Types.ObjectId
  saleShortId?: string
  tillCode?: string
  note?: string
  returnLines: ISaleExchangeReturnLine[]
  returnTotal: number
  newLines: ISaleExchangeNewLine[]
  newTotal: number
  netAmount: number
  settlementKind: SaleExchangeSettlementKind
  cashPaidIn: number
  cashPaidOut: number
  storeCreditIssued?: number
  storeCreditPhone?: string
  reversedStoreCredit?: number
  reversedOnAccount?: number
  adminBypassEligibility?: boolean
  exchangedBy: Types.ObjectId
}

const returnLineSchema = new Schema<ISaleExchangeReturnLine>(
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

const newLineSchema = new Schema<ISaleExchangeNewLine>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    sku: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, required: true, min: 0 },
    listUnitPrice: { type: Number, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const saleExchangeSchema = new Schema<ISaleExchange>(
  {
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
    saleShortId: { type: String, trim: true, index: true },
    tillCode: { type: String, trim: true, index: true },
    note: { type: String, trim: true },
    returnLines: { type: [returnLineSchema], required: true },
    returnTotal: { type: Number, required: true, min: 0.01 },
    newLines: { type: [newLineSchema], required: true },
    newTotal: { type: Number, required: true, min: 0.01 },
    netAmount: { type: Number, required: true },
    settlementKind: {
      type: String,
      enum: ['even', 'customer_pays_cash', 'customer_receives_cash', 'customer_receives_store_credit'],
      required: true,
    },
    cashPaidIn: { type: Number, required: true, min: 0, default: 0 },
    cashPaidOut: { type: Number, required: true, min: 0, default: 0 },
    storeCreditIssued: { type: Number, min: 0 },
    storeCreditPhone: { type: String, trim: true },
    reversedStoreCredit: { type: Number, min: 0, default: 0 },
    reversedOnAccount: { type: Number, min: 0, default: 0 },
    adminBypassEligibility: { type: Boolean, default: false },
    exchangedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
)

export const SaleExchange = mongoose.model<ISaleExchange>('SaleExchange', saleExchangeSchema)
