import mongoose, { Schema, type Types } from 'mongoose'

export interface IManualReturnLine {
  product?: Types.ObjectId
  sku?: string
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface IManualReturn {
  /** Short public id (10 hex chars), like saleId. */
  returnId: string
  tillCode?: string
  note: string
  lines: IManualReturnLine[]
  returnTotal: number
  payoutMethod: 'cash' | 'card' | 'store_credit'
  returnCash: number
  returnCard: number
  returnStoreCreditIssued?: number
  storeCreditPhone?: string
  processedBy: Types.ObjectId
}

const manualReturnLineSchema = new Schema<IManualReturnLine>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    sku: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const manualReturnSchema = new Schema<IManualReturn>(
  {
    returnId: { type: String, required: true, trim: true, unique: true, index: true },
    tillCode: { type: String, trim: true, index: true },
    note: { type: String, required: true, trim: true },
    lines: { type: [manualReturnLineSchema], required: true },
    returnTotal: { type: Number, required: true, min: 0.01 },
    payoutMethod: { type: String, enum: ['cash', 'card', 'store_credit'], required: true },
    returnCash: { type: Number, required: true, min: 0, default: 0 },
    returnCard: { type: Number, required: true, min: 0, default: 0 },
    returnStoreCreditIssued: { type: Number, min: 0 },
    storeCreditPhone: { type: String, trim: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
)

export const ManualReturn = mongoose.model<IManualReturn>('ManualReturn', manualReturnSchema)
