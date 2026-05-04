import mongoose, { Schema, type Types } from 'mongoose'

export interface IRole {
  _id: Types.ObjectId
  slug: string
  name: string
  /** Permission ids; use `*` for full access (system admin). */
  permissions: string[]
  isSystem: boolean
}

const roleSchema = new Schema<IRole>(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export const Role = mongoose.model<IRole>('Role', roleSchema)
