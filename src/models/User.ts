import mongoose, { Schema, type Types } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUserLegacy {
  source: 'vector'
  userNo?: number
  level?: number
  canLogin?: boolean
}

export interface IUser {
  email: string
  badgeCode?: string
  passwordHash: string
  roleId: Types.ObjectId
  displayName?: string
  active?: boolean
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
