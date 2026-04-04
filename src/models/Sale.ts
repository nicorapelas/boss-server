import mongoose, { Schema, Types } from 'mongoose'

export interface ISaleLine {
  product?: Types.ObjectId
  sku?: string
  legacyItemNo?: number
  legacyItemType?: number
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface ISaleLegacy {
  source: 'vector'
  receiptNo: number
  terminal: number
  transactionType?: number
  userNo?: number
}

export interface ISalePayment {
  cashAmount?: number
  cardAmount?: number
  tenderedCash?: number
  changeDue?: number
}

export interface ISale {
  cashier?: Types.ObjectId | null
  items: ISaleLine[]
  total: number
  paymentMethod?: string
  payment?: ISalePayment
  /** Idempotency for offline sync — same key from client = single sale */
  clientLocalId?: string | null
  legacy?: ISaleLegacy
  /** Stock release for a completed lay-by — excluded from standard financial totals */
  layById?: Types.ObjectId | null
  /** Amount paid from customer store credit account (VAT-inclusive) */
  storeCreditAmount?: number
  /** Sale converted from an open quote (snapshot pricing) */
  quoteId?: Types.ObjectId | null
  /** Portion charged to house / on-account (AR), VAT-inclusive */
  onAccountAmount?: number
  houseAccountId?: Types.ObjectId | null
  /** Snapshot for receipts (e.g. ACC-00007) */
  houseAccountNumber?: string
  /** Account holder name snapshot for signed receipts */
  houseAccountName?: string
}

const saleLineSchema = new Schema<ISaleLine>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    sku: { type: String, trim: true },
    legacyItemNo: { type: Number },
    legacyItemType: { type: Number },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const saleSchema = new Schema<ISale>(
  {
    cashier: { type: Schema.Types.ObjectId, ref: 'User' },
    items: { type: [saleLineSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, trim: true },
    payment: {
      cashAmount: { type: Number, min: 0, default: 0 },
      cardAmount: { type: Number, min: 0, default: 0 },
      tenderedCash: { type: Number, min: 0 },
      changeDue: { type: Number, min: 0 },
    },
    clientLocalId: { type: String, trim: true, sparse: true, unique: true },
    layById: { type: Schema.Types.ObjectId, ref: 'LayBy', default: null, sparse: true, index: true },
    storeCreditAmount: { type: Number, min: 0 },
    quoteId: { type: Schema.Types.ObjectId, ref: 'Quote', default: null, sparse: true, index: true },
    onAccountAmount: { type: Number, min: 0 },
    houseAccountId: { type: Schema.Types.ObjectId, ref: 'HouseAccount', default: null, sparse: true, index: true },
    houseAccountNumber: { type: String, trim: true },
    houseAccountName: { type: String, trim: true },
    legacy: {
      source: { type: String, enum: ['vector'] },
      receiptNo: { type: Number },
      terminal: { type: Number },
      transactionType: { type: Number },
      userNo: { type: Number },
    },
  },
  { timestamps: true },
)

saleSchema.index(
  { 'legacy.source': 1, 'legacy.receiptNo': 1, 'legacy.terminal': 1 },
  { unique: true, sparse: true },
)

export const Sale = mongoose.model<ISale>('Sale', saleSchema)
