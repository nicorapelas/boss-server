import mongoose, { Schema, Types } from 'mongoose'

export interface IShiftCashDifference {
  kind: 'over' | 'under'
  amount: number
  note?: string
  source: 'pos' | 'backoffice'
  createdBy: Types.ObjectId
  createdAt: Date
}

export interface IShiftSummary {
  turnover: number
  cashSales: number
  cardSales: number
  voucherTotal: number
  onAccountTotal: number
  refundTotal: number
  refundCashTotal: number
  refundCardTotal: number
  refundCount: number
  layByCompletions: number
  layByPaymentCount?: number
  layByPaymentCashTotal?: number
  layByPaymentCardTotal?: number
  layByPaymentStoreCreditTotal?: number
  layByPaymentTotal?: number
  quoteConversions: number
  tabClosures: number
  cashierSales: Array<{
    cashierId: Types.ObjectId
    cashierName?: string
    salesCount: number
    total: number
  }>
  refundDetails?: Array<{
    saleId?: string
    cashierId?: Types.ObjectId
    cashierName?: string
    method?: 'cash' | 'card' | 'store_credit'
    refundTotal: number
    refundCash: number
    refundCard: number
  }>
  priceOverrides?: Array<{
    saleId?: string
    cashierId?: Types.ObjectId
    cashierName?: string
    itemName: string
    quantity: number
    listUnitPrice: number
    overriddenUnitPrice: number
    lineDiscount: number
  }>
}

export interface IShiftSession {
  tillCode: string
  status: 'open' | 'closed'
  openedAt: Date
  openedBy?: Types.ObjectId | null
  closedAt?: Date | null
  closedBy?: Types.ObjectId | null
  zNumber?: number | null
  summary?: IShiftSummary
  cashDifferences: IShiftCashDifference[]
}

const diffSchema = new Schema<IShiftCashDifference>(
  {
    kind: { type: String, enum: ['over', 'under'], required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true },
    source: { type: String, enum: ['pos', 'backoffice'], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false },
)

const summarySchema = new Schema<IShiftSummary>(
  {
    /** Net of refunds in this shift (can be negative if refunds exceed sales in window). */
    turnover: { type: Number, required: true, default: 0 },
    cashSales: { type: Number, required: true, default: 0 },
    cardSales: { type: Number, required: true, default: 0 },
    voucherTotal: { type: Number, required: true, min: 0, default: 0 },
    onAccountTotal: { type: Number, required: true, min: 0, default: 0 },
    refundTotal: { type: Number, required: true, min: 0, default: 0 },
    refundCashTotal: { type: Number, required: true, min: 0, default: 0 },
    refundCardTotal: { type: Number, required: true, min: 0, default: 0 },
    refundCount: { type: Number, required: true, min: 0, default: 0 },
    layByCompletions: { type: Number, required: true, min: 0, default: 0 },
    layByPaymentCount: { type: Number, required: false, min: 0, default: 0 },
    layByPaymentCashTotal: { type: Number, required: false, min: 0, default: 0 },
    layByPaymentCardTotal: { type: Number, required: false, min: 0, default: 0 },
    layByPaymentStoreCreditTotal: { type: Number, required: false, min: 0, default: 0 },
    layByPaymentTotal: { type: Number, required: false, min: 0, default: 0 },
    quoteConversions: { type: Number, required: true, min: 0, default: 0 },
    tabClosures: { type: Number, required: true, min: 0, default: 0 },
    cashierSales: [
      {
        cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        cashierName: { type: String, trim: true },
        salesCount: { type: Number, required: true, min: 0, default: 0 },
        /** Net sale totals attributed to cashier minus refunds on those sales (this shift). */
        total: { type: Number, required: true, default: 0 },
      },
    ],
    refundDetails: [
      {
        saleId: { type: String, trim: true },
        cashierId: { type: Schema.Types.ObjectId, ref: 'User' },
        cashierName: { type: String, trim: true },
        method: { type: String, enum: ['cash', 'card', 'store_credit'] },
        refundTotal: { type: Number, required: true, min: 0, default: 0 },
        refundCash: { type: Number, required: true, min: 0, default: 0 },
        refundCard: { type: Number, required: true, min: 0, default: 0 },
      },
    ],
    priceOverrides: [
      {
        saleId: { type: String, trim: true },
        cashierId: { type: Schema.Types.ObjectId, ref: 'User' },
        cashierName: { type: String, trim: true },
        itemName: { type: String, trim: true, required: true },
        quantity: { type: Number, required: true, min: 0 },
        listUnitPrice: { type: Number, required: true, min: 0 },
        overriddenUnitPrice: { type: Number, required: true, min: 0 },
        lineDiscount: { type: Number, required: true, min: 0, default: 0 },
      },
    ],
  },
  { _id: false },
)

const shiftSchema = new Schema<IShiftSession>(
  {
    tillCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    openedAt: { type: Date, required: true, default: () => new Date(), index: true },
    openedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null, index: true },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    zNumber: { type: Number, min: 1, default: null },
    summary: { type: summarySchema, required: false },
    cashDifferences: { type: [diffSchema], default: [] },
  },
  { timestamps: true },
)

shiftSchema.index(
  { tillCode: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
)
shiftSchema.index({ tillCode: 1, zNumber: 1 }, { unique: true, sparse: true })

export const ShiftSession = mongoose.model<IShiftSession>('ShiftSession', shiftSchema)
