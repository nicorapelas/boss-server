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

export type ICustomerDisplayIdle = {
  headline: string
  subtext: string
  imageUrl: string
}

export type ICustomerDisplayTheme = {
  backgroundColor: string
  accentColor: string
}

export type ICustomerDisplayConfig = {
  enabled: boolean
  idle: ICustomerDisplayIdle
  theme: ICustomerDisplayTheme
  footerText: string
}

const customerDisplayIdleSchema = new Schema(
  {
    headline: { type: String, trim: true, default: 'Welcome' },
    subtext: { type: String, trim: true, default: '' },
    imageUrl: { type: String, trim: true, default: '' },
  },
  { _id: false },
)

const customerDisplayThemeSchema = new Schema(
  {
    backgroundColor: { type: String, trim: true, default: '#0f1419' },
    accentColor: { type: String, trim: true, default: '#3b82f6' },
  },
  { _id: false },
)

const customerDisplaySchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    idle: { type: customerDisplayIdleSchema, default: () => ({}) },
    theme: { type: customerDisplayThemeSchema, default: () => ({}) },
    footerText: { type: String, trim: true, default: 'All prices include VAT' },
  },
  { _id: false },
)

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
  /** Customer-facing second screen (idle content when POS logged out). */
  customerDisplay?: ICustomerDisplayConfig
  /** Incremented when Back Office requests all tills to refresh product catalog. */
  catalogRevision: number
  /** ISO timestamp of last catalog push (informational). */
  catalogPushedAt: string | null
}

const storeSettingsSchema = new Schema<IStoreSettings>(
  {
    _id: { type: String, required: true, default: 'default' },
    storeName: { type: String, trim: true, default: 'CogniPOS' },
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
    customerDisplay: {
      type: customerDisplaySchema,
      default: () => ({
        enabled: true,
        idle: { headline: 'Welcome', subtext: '', imageUrl: '' },
        theme: { backgroundColor: '#0f1419', accentColor: '#3b82f6' },
        footerText: 'All prices include VAT',
      }),
    },
    catalogRevision: { type: Number, default: 0, min: 0 },
    catalogPushedAt: { type: String, default: null },
  },
  { _id: false },
)

export const StoreSettings = mongoose.model<IStoreSettings>('StoreSettings', storeSettingsSchema)
