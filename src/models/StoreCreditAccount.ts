import mongoose, { Schema, Types } from 'mongoose'

export interface IStoreCreditAccount {
  phone: string
  name: string
  balance: number
}

const storeCreditAccountSchema = new Schema<IStoreCreditAccount>(
  {
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
)

export const StoreCreditAccount = mongoose.model<IStoreCreditAccount>(
  'StoreCreditAccount',
  storeCreditAccountSchema,
)

export interface IStoreCreditLedgerEntry {
  accountId: Types.ObjectId
  phone: string
  amount: number
  kind: 'issue' | 'redeem'
  refType: 'layby_cancel' | 'sale' | 'sale_exchange' | 'manual_return'
  refId: Types.ObjectId
  note?: string
  createdBy?: Types.ObjectId
}

const ledgerSchema = new Schema<IStoreCreditLedgerEntry>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'StoreCreditAccount', required: true },
    phone: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    kind: { type: String, enum: ['issue', 'redeem'], required: true },
    refType: { type: String, enum: ['layby_cancel', 'sale', 'sale_exchange', 'manual_return'], required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

export const StoreCreditLedger = mongoose.model<IStoreCreditLedgerEntry>(
  'StoreCreditLedger',
  ledgerSchema,
)
