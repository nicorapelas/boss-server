import mongoose, { Schema, Types } from 'mongoose'

/** Human-facing sale identifier (10 hex chars, unique) — set on new sales only. */
const SALE_ID_HEX_LEN = 10

export interface ISaleLine {
  product?: Types.ObjectId
  sku?: string
  legacyItemNo?: number
  legacyItemType?: number
  name: string
  quantity: number
  unitPrice: number
  listUnitPrice?: number
  /** POS manager-approved stock override marker for audit. */
  stockOverrideApproved?: boolean
  /** Override source context at checkout time. */
  stockOverrideScope?: 'offline' | 'online'
  /** Catalog available qty snapshot seen by POS when override was approved. */
  stockOverrideAvailableQty?: number
  lineTotal: number
  /** Snapshot: staff who rang this line (e.g. job card multi-user). */
  addedByUserId?: Types.ObjectId | null
  addedByDisplayName?: string
  addedAt?: Date | null
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
  /** Optional customer purchase order reference for on-account charges. */
  purchaseOrderNumber?: string
  /** Register / till code snapshot from POS device config. */
  tillCode?: string
  /** Active shift session when sale was recorded. */
  shiftId?: Types.ObjectId | null
  /** 10-character hex id for receipts, refunds, and search (not the Mongo _id) */
  saleId?: string
  /** Partial/full refund state driven by SaleRefund records. */
  refundStatus?: 'partial' | 'refunded'
  refundedAt?: Date
  refundedBy?: Types.ObjectId | null
  refundNote?: string
  /** How cashier settled the customer refund at the till. */
  refundPayoutMethod?: 'cash' | 'card' | 'store_credit'
  /** Amount settled via chosen payout method (full sale refund). */
  refundPayoutAmount?: number
  /** Normalized loyalty member phone snapshot. */
  loyaltyPhone?: string | null
  loyaltyMemberId?: Types.ObjectId | null
  loyaltyPointsEarned?: number
  loyaltyPointsRedeemed?: number
  /** Rand discount from redeemed loyalty points (counts toward payment coverage). */
  loyaltyDiscountAmount?: number
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
    listUnitPrice: { type: Number, min: 0 },
    stockOverrideApproved: { type: Boolean, default: false },
    stockOverrideScope: { type: String, enum: ['offline', 'online'] },
    stockOverrideAvailableQty: { type: Number },
    lineTotal: { type: Number, required: true, min: 0 },
    addedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    addedByDisplayName: { type: String, trim: true, maxlength: 120 },
    addedAt: { type: Date, default: null },
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
    purchaseOrderNumber: { type: String, trim: true, maxlength: 120 },
    tillCode: { type: String, trim: true, index: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'ShiftSession', default: null, sparse: true, index: true },
    saleId: { type: String, trim: true, minlength: SALE_ID_HEX_LEN, maxlength: SALE_ID_HEX_LEN, sparse: true, unique: true, index: true },
    refundStatus: { type: String, enum: ['partial', 'refunded'], sparse: true, index: true },
    refundedAt: { type: Date },
    refundedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    refundNote: { type: String, trim: true },
    refundPayoutMethod: { type: String, enum: ['cash', 'card', 'store_credit'], trim: true },
    refundPayoutAmount: { type: Number, min: 0 },
    loyaltyPhone: { type: String, trim: true, sparse: true, index: true },
    loyaltyMemberId: { type: Schema.Types.ObjectId, ref: 'LoyaltyMember', default: null, sparse: true, index: true },
    loyaltyPointsEarned: { type: Number, min: 0 },
    loyaltyPointsRedeemed: { type: Number, min: 0 },
    loyaltyDiscountAmount: { type: Number, min: 0 },
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
