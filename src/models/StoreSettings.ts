import mongoose, { Schema } from 'mongoose'

const presetEntrySchema = new Schema(
  {
    productId: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    subCategory: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
  },
  { _id: false },
)

const productPresetsSchema = new Schema(
  {
    entries: { type: [presetEntrySchema], default: [] },
    categories: { type: [String], default: [] },
    subCategoriesByCategory: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
)

export type IProductPresetsState = {
  entries: Array<{
    productId: string
    category: string
    subCategory: string
    label: string
  }>
  categories: string[]
  subCategoriesByCategory: Record<string, string[]>
}

/** Singleton POS / receipt / lay-by settings (one document). */
export interface IStoreSettings {
  _id: string
  storeName: string
  storeAddressLines: string[]
  storePhone: string
  storeVatNumber: string
  layByTerms: string
  defaultDepositPercent: number
  defaultExpiryMonths: number
  /** South Africa VAT as decimal, e.g. 0.14 for 14% */
  vatRate: number
  nextLayBySeq: number
  /** Last assigned quote sequence number; next quote uses atomic increment. */
  nextQuoteSeq: number
  /** Last assigned house account sequence; next account uses atomic increment. */
  nextHouseAccountSeq: number
  /** Last assigned job card sequence; next job card uses atomic increment. */
  nextJobCardSeq: number
  /** Shared POS preset buttons (category → sub-category → product); synced to all tills. */
  productPresets?: IProductPresetsState
}

const storeSettingsSchema = new Schema<IStoreSettings>(
  {
    _id: { type: String, required: true, default: 'default' },
    storeName: { type: String, trim: true, default: 'ElectroPOS' },
    storeAddressLines: { type: [String], default: [] },
    storePhone: { type: String, trim: true, default: '' },
    storeVatNumber: { type: String, trim: true, default: '' },
    layByTerms: { type: String, default: '' },
    defaultDepositPercent: { type: Number, default: 30, min: 0, max: 100 },
    defaultExpiryMonths: { type: Number, default: 3, min: 1, max: 120 },
    vatRate: { type: Number, default: 0.14, min: 0, max: 0.5 },
    nextLayBySeq: { type: Number, default: 1, min: 1 },
    /** Last assigned quote sequence (next quote = this + 1 atomically). */
    nextQuoteSeq: { type: Number, default: 0, min: 0 },
    nextHouseAccountSeq: { type: Number, default: 0, min: 0 },
    nextJobCardSeq: { type: Number, default: 0, min: 0 },
    productPresets: {
      type: productPresetsSchema,
      default: () => ({ entries: [], categories: [], subCategoriesByCategory: {} }),
    },
  },
  { _id: false },
)

export const StoreSettings = mongoose.model<IStoreSettings>('StoreSettings', storeSettingsSchema)
