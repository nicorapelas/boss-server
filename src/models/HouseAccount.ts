import mongoose, { Schema, Types } from 'mongoose'

export const HOUSE_ACCOUNT_PAYMENT_TERMS = ['', 'cod', '7_days', '30_days', 'end_of_month'] as const
export type HouseAccountPaymentTerms = (typeof HOUSE_ACCOUNT_PAYMENT_TERMS)[number]

/** Trade / house account: positive balance = amount customer owes (AR). */
export interface IHouseAccount {
  accountNumber: string
  name: string
  phone: string
  contactPerson: string
  email: string
  vatNumber: string
  addressLines: string[]
  paymentTerms: HouseAccountPaymentTerms
  notes: string
  balance: number
  /** Max allowed balance (owed); null/undefined = no limit */
  creditLimit: number | null
  status: 'active' | 'closed'
}

const houseAccountSchema = new Schema<IHouseAccount>(
  {
    accountNumber: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true, index: true },
    contactPerson: { type: String, default: '', trim: true, index: true },
    email: { type: String, default: '', trim: true, lowercase: true, index: true },
    vatNumber: { type: String, default: '', trim: true, index: true },
    addressLines: { type: [String], default: [] },
    paymentTerms: {
      type: String,
      enum: HOUSE_ACCOUNT_PAYMENT_TERMS,
      default: '',
    },
    notes: { type: String, default: '', trim: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
    creditLimit: { type: Number, min: 0, default: null },
    status: { type: String, enum: ['active', 'closed'], default: 'active', index: true },
  },
  { timestamps: true },
)

export const HouseAccount = mongoose.model<IHouseAccount>('HouseAccount', houseAccountSchema)

export interface IHouseAccountLedgerEntry {
  houseAccountId: Types.ObjectId
  accountNumber: string
  kind: 'charge' | 'payment'
  amount: number
  saleId?: Types.ObjectId | null
  cashAmount?: number
  cardAmount?: number
  note?: string
  createdBy?: Types.ObjectId
}

const houseLedgerSchema = new Schema<IHouseAccountLedgerEntry>(
  {
    houseAccountId: { type: Schema.Types.ObjectId, ref: 'HouseAccount', required: true, index: true },
    accountNumber: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['charge', 'payment'], required: true },
    amount: { type: Number, required: true, min: 0 },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
    cashAmount: { type: Number, min: 0 },
    cardAmount: { type: Number, min: 0 },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

export const HouseAccountLedger = mongoose.model<IHouseAccountLedgerEntry>(
  'HouseAccountLedger',
  houseLedgerSchema,
)
