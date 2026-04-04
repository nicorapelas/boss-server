import mongoose, { Schema, Types } from 'mongoose'

export interface IQuoteLine {
  productId: Types.ObjectId
  name: string
  sku: string
  quantity: number
  /** VAT-inclusive unit price (snapshot) */
  unitPrice: number
  lineTotal: number
  listUnitPrice?: number
}

export interface IQuote {
  /** Global monotonic sequence (unique). */
  sequenceNumber: number
  quoteNumber: string
  customerName: string
  phone: string
  lines: IQuoteLine[]
  vatRate: number
  totalInclVat: number
  totalVatAmount: number
  totalNetAmount: number
  validUntil: Date
  status: 'open' | 'converted' | 'cancelled'
  convertedSaleId?: Types.ObjectId | null
  createdBy?: Types.ObjectId | null
}

const quoteLineSchema = new Schema<IQuoteLine>(
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

const quoteSchema = new Schema<IQuote>(
  {
    sequenceNumber: { type: Number, required: true, min: 1, unique: true, index: true },
    quoteNumber: { type: String, required: true, unique: true, trim: true },
    customerName: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true, index: true },
    lines: { type: [quoteLineSchema], required: true },
    vatRate: { type: Number, required: true, min: 0, max: 0.5 },
    totalInclVat: { type: Number, required: true, min: 0 },
    totalVatAmount: { type: Number, required: true, min: 0 },
    totalNetAmount: { type: Number, required: true, min: 0 },
    validUntil: { type: Date, required: true, index: true },
    status: { type: String, enum: ['open', 'converted', 'cancelled'], default: 'open', index: true },
    convertedSaleId: { type: Schema.Types.ObjectId, ref: 'Sale', default: null, sparse: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

export const Quote = mongoose.model<IQuote>('Quote', quoteSchema)
