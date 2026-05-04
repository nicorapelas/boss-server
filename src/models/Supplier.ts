import mongoose, { Schema } from 'mongoose'

export interface ISupplier {
  name: string
  /** Short stable id, e.g. ACME — unique. */
  code: string
  active: boolean
  contactName?: string | null
  email?: string | null
  phone?: string | null
  /** Your account number on the supplier's system. */
  accountNumber?: string | null
  /** Terms, min order, ordering notes (internal). */
  notes?: string | null
}

const supplierSchema = new Schema<ISupplier>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    active: { type: Boolean, default: true, index: true },
    contactName: { type: String, trim: true, default: null },
    email: { type: String, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
    accountNumber: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
  },
  { timestamps: true },
)

export const Supplier = mongoose.model<ISupplier>('Supplier', supplierSchema)
