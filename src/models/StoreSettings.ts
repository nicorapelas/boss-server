import mongoose, { Schema } from 'mongoose'

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
  },
  { _id: false },
)

export const StoreSettings = mongoose.model<IStoreSettings>('StoreSettings', storeSettingsSchema)
