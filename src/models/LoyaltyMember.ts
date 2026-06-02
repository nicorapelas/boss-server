import mongoose, { Schema, Types } from 'mongoose'

export interface ILoyaltyMember {
  phone: string
  pointsBalance: number
  status: 'active' | 'blocked'
  optedInAt?: Date | null
}

const loyaltyMemberSchema = new Schema<ILoyaltyMember>(
  {
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    pointsBalance: { type: Number, required: true, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'blocked'], default: 'active', index: true },
    optedInAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export const LoyaltyMember = mongoose.model<ILoyaltyMember>('LoyaltyMember', loyaltyMemberSchema)

export interface ILoyaltyLedgerEntry {
  memberId: Types.ObjectId
  phone: string
  points: number
  kind: 'earn' | 'redeem' | 'refund_clawback' | 'refund_restore' | 'adjust' | 'phone_change'
  refType: 'sale' | 'refund' | 'admin'
  refId?: Types.ObjectId | null
  note?: string
  createdBy?: Types.ObjectId | null
}

const loyaltyLedgerSchema = new Schema<ILoyaltyLedgerEntry>(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'LoyaltyMember', required: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    points: { type: Number, required: true },
    kind: {
      type: String,
      enum: ['earn', 'redeem', 'refund_clawback', 'refund_restore', 'adjust', 'phone_change'],
      required: true,
    },
    refType: { type: String, enum: ['sale', 'refund', 'admin'], required: true },
    refId: { type: Schema.Types.ObjectId, default: null, index: true },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

export const LoyaltyLedger = mongoose.model<ILoyaltyLedgerEntry>('LoyaltyLedger', loyaltyLedgerSchema)

export interface ILoyaltyPhoneChange {
  memberId: Types.ObjectId
  fromPhone: string
  toPhone: string
  changedBy: Types.ObjectId
  note?: string
}

const loyaltyPhoneChangeSchema = new Schema<ILoyaltyPhoneChange>(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'LoyaltyMember', required: true, index: true },
    fromPhone: { type: String, required: true, trim: true },
    toPhone: { type: String, required: true, trim: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, trim: true },
  },
  { timestamps: true },
)

export const LoyaltyPhoneChange = mongoose.model<ILoyaltyPhoneChange>(
  'LoyaltyPhoneChange',
  loyaltyPhoneChangeSchema,
)
