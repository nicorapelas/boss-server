import mongoose, { Schema, Types } from 'mongoose'

/**
 * One row per (product, supplier): reordering terms and comparable unit cost.
 * unitCost is per product stock unit (same unit as POS/catalog stock).
 */
export interface ISupplierOffer {
  product: Types.ObjectId
  supplier: Types.ObjectId
  supplierSku?: string | null
  /** Cost per single product stock unit (for price comparison across suppliers). */
  unitCost: number
  /** How many stock units come in one supplier “pack” when ordering (min 1). */
  unitsPerPack: number
  /** Minimum order quantity in stock units. */
  minOrderQty: number
  leadTimeDays?: number | null
  preferred: boolean
  /** When this unit cost was quoted / last confirmed. */
  priceEffectiveDate?: Date | null
}

const supplierOfferSchema = new Schema<ISupplierOffer>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    supplierSku: { type: String, trim: true, default: null },
    unitCost: { type: Number, required: true, min: 0 },
    unitsPerPack: { type: Number, required: true, min: 1, default: 1 },
    minOrderQty: { type: Number, required: true, min: 1, default: 1 },
    leadTimeDays: { type: Number, min: 0, default: null },
    preferred: { type: Boolean, default: false, index: true },
    priceEffectiveDate: { type: Date, default: null },
  },
  { timestamps: true },
)

supplierOfferSchema.index({ supplier: 1, product: 1 }, { unique: true })

export const SupplierOffer = mongoose.model<ISupplierOffer>('SupplierOffer', supplierOfferSchema)
