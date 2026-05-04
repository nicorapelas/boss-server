import mongoose, { Schema, Types } from 'mongoose'

export interface ILayByLine {
  productId: Types.ObjectId
  name: string
  sku: string
  quantity: number
  /** Unit price VAT-inclusive (shelf price) */
  unitPrice: number
  lineTotal: number
  listUnitPrice?: number
}

export interface ILayByPayment {
  amount: number
  cashAmount: number
  cardAmount: number
  storeCreditAmount: number
  /** Till where payment was recorded (POS), normalized uppercase. */
  tillCode?: string
  /** Shift session at time of payment (best-effort). */
  shiftId?: Types.ObjectId | null
  createdAt: Date
  createdBy: Types.ObjectId
}

export interface ILayByCancellation {
  mode: 'full_refund' | 'percent_refund' | 'store_credit'
  percent?: number
  refundAmount?: number
  storeCreditIssued?: number
  at: Date
  by: Types.ObjectId
}

export interface ILayBy {
  layByNumber: string
  customerName: string
  phone: string
  lines: ILayByLine[]
  vatRate: number
  totalInclVat: number
  totalVatAmount: number
  totalNetAmount: number
  depositPercentUsed: number
  depositAmount: number
  amountPaid: number
  balance: number
  status: 'active' | 'completed' | 'cancelled'
  expiresAt: Date
  payments: ILayByPayment[]
  cancellation?: ILayByCancellation
  completedSaleId?: Types.ObjectId | null
  createdBy?: Types.ObjectId | null
}

const layByLineSchema = new Schema<ILayByLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    listUnitPrice: { type: Number, min: 0 },
  },
  { _id: false },
)

const layByPaymentSchema = new Schema<ILayByPayment>(
  {
    amount: { type: Number, required: true, min: 0 },
    cashAmount: { type: Number, required: true, min: 0 },
    cardAmount: { type: Number, required: true, min: 0 },
    storeCreditAmount: { type: Number, default: 0, min: 0 },
    tillCode: { type: String, trim: true, uppercase: true, index: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'ShiftSession', default: null, sparse: true, index: true },
    createdAt: { type: Date, default: () => new Date() },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
)

const cancellationSchema = new Schema<ILayByCancellation>(
  {
    mode: { type: String, enum: ['full_refund', 'percent_refund', 'store_credit'], required: true },
    percent: { type: Number, min: 0, max: 100 },
    refundAmount: { type: Number, min: 0 },
    storeCreditIssued: { type: Number, min: 0 },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
)

const layBySchema = new Schema<ILayBy>(
  {
    layByNumber: { type: String, required: true, unique: true, trim: true, index: true },
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    lines: { type: [layByLineSchema], required: true },
    vatRate: { type: Number, required: true },
    totalInclVat: { type: Number, required: true, min: 0 },
    totalVatAmount: { type: Number, required: true, min: 0 },
    totalNetAmount: { type: Number, required: true, min: 0 },
    depositPercentUsed: { type: Number, required: true, min: 0, max: 100 },
    depositAmount: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, required: true, min: 0 },
    balance: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
    expiresAt: { type: Date, required: true },
    payments: { type: [layByPaymentSchema], default: [] },
    cancellation: { type: cancellationSchema },
    completedSaleId: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

export const LayBy = mongoose.model<ILayBy>('LayBy', layBySchema)
