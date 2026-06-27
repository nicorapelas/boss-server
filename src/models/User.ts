import mongoose, { Schema, type Types } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUserLegacy {
  source: 'vector'
  userNo?: number
  level?: number
  canLogin?: boolean
}

export type UserPaymentTerms = 'weekly' | 'biweekly' | 'monthly' | 'custom'

export interface IUserStaffDocument {
  originalName: string
  mimeType?: string
  uploadedAt: Date
  uploadedBy?: Types.ObjectId | null
}

export interface IUserStaffLoan {
  startDate?: Date | null
  amount?: number | null
  terms?: string | null
  notes?: string | null
}

export interface IUserHrProfile {
  phone?: string | null
  startDate?: Date | null
  paymentTerms?: UserPaymentTerms | null
  paymentAmount?: number | null
  notes?: string | null
  scoreCard?: string | null
  contractDocument?: IUserStaffDocument | null
  idDocument?: IUserStaffDocument | null
  loans?: IUserStaffLoan[]
}

export interface IUserFaceEnrollment {
  /** Averaged 128-D face descriptor (face-api). */
  embedding: number[]
  modelId: string
  sampleCount: number
  enrolledAt: Date
  enrolledBy?: Types.ObjectId | null
  /** When the staff member gave consent for biometric capture. */
  staffConsentAt?: Date
  /** Back Office user who recorded staff consent. */
  staffConsentRecordedBy?: Types.ObjectId | null
  consentVersion?: string
}

export interface IUser {
  email: string
  badgeCode?: string
  passwordHash: string
  roleId: Types.ObjectId
  displayName?: string
  active?: boolean
  allowOfflineLogin?: boolean
  allowShopAssistCatalogAdjustment?: boolean
  faceEnrollment?: IUserFaceEnrollment | null
  hrProfile?: IUserHrProfile | null
  legacy?: IUserLegacy
  refreshTokenHash?: string | null
  refreshTokenExpires?: Date | null
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    badgeCode: { type: String, unique: true, sparse: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, trim: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    active: { type: Boolean, default: true },
    allowOfflineLogin: { type: Boolean, default: false },
    allowShopAssistCatalogAdjustment: { type: Boolean, default: false },
    faceEnrollment: {
      embedding: { type: [Number], default: undefined },
      modelId: { type: String, trim: true },
      sampleCount: { type: Number, min: 1 },
      enrolledAt: { type: Date },
      enrolledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      staffConsentAt: { type: Date },
      staffConsentRecordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      consentVersion: { type: String, trim: true },
    },
    hrProfile: {
      phone: { type: String, trim: true, default: null },
      startDate: { type: Date, default: null },
      paymentTerms: {
        type: String,
        enum: ['weekly', 'biweekly', 'monthly', 'custom', null],
        default: null,
      },
      paymentAmount: { type: Number, min: 0, default: null },
      notes: { type: String, trim: true, default: null },
      scoreCard: { type: String, trim: true, default: null },
      contractDocument: {
        originalName: { type: String, trim: true },
        mimeType: { type: String, trim: true },
        uploadedAt: { type: Date },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      },
      idDocument: {
        originalName: { type: String, trim: true },
        mimeType: { type: String, trim: true },
        uploadedAt: { type: Date },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      },
      loans: [
        {
          startDate: { type: Date, default: null },
          amount: { type: Number, min: 0, default: null },
          terms: { type: String, trim: true, default: null },
          notes: { type: String, trim: true, default: null },
        },
      ],
    },
    legacy: {
      source: { type: String, enum: ['vector'] },
      userNo: { type: Number },
      level: { type: Number },
      canLogin: { type: Boolean, default: true },
    },
    refreshTokenHash: { type: String, default: null },
    refreshTokenExpires: { type: Date, default: null },
  },
  { timestamps: true },
)

userSchema.index(
  { 'legacy.source': 1, 'legacy.userNo': 1 },
  { unique: true, sparse: true },
)

export const User = mongoose.model<IUser>('User', userSchema)

export async function hashPassword(plain: string) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(plain, salt)
}
