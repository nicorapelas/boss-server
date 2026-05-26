import mongoose, { Schema, Types } from 'mongoose'

export interface IShopAssistCartLine {
  productId: Types.ObjectId
  sku: string
  barcode?: string | null
  name: string
  quantity: number
  unitPrice: number
}

export interface IShopAssistCart {
  tokenHash: string
  status: 'ready' | 'claimed' | 'expired'
  lines: IShopAssistCartLine[]
  createdBy: Types.ObjectId
  createdByEmail?: string
  claimedBy?: Types.ObjectId | null
  claimedAt?: Date | null
  expiresAt: Date
}

const shopAssistCartLineSchema = new Schema<IShopAssistCartLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true, trim: true },
    barcode: { type: String, trim: true, default: null },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const shopAssistCartSchema = new Schema<IShopAssistCart>(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['ready', 'claimed', 'expired'], default: 'ready', index: true },
    lines: { type: [shopAssistCartLineSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdByEmail: { type: String, trim: true },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    claimedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
)

shopAssistCartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const ShopAssistCart = mongoose.model<IShopAssistCart>('ShopAssistCart', shopAssistCartSchema)
