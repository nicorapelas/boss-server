import mongoose, { Schema, Types } from 'mongoose'

export interface IOpenTabLine {
  productId: Types.ObjectId
  name: string
  quantity: number
  unitPrice: number
  listUnitPrice?: number
  /** Staff who added this line (job card / tab audit). */
  addedByUserId?: Types.ObjectId | null
  addedByDisplayName?: string
  addedAt?: Date | null
}

export type OpenTabKind = 'tab' | 'job_card'

export interface IOpenTab {
  kind: OpenTabKind
  tabNumber: string
  /** Set when kind === job_card'; matches tabNumber (unique open-tab key). */
  jobNumber?: string | null
  /** Job card: item received / checked in (e.g. model, serial). */
  itemCheckedIn?: string
  /** Job card: work to be done. */
  jobDescription?: string
  /** Job card: printed under "Note:" on workshop/item slip only. */
  attachmentNote?: string
  customerName: string
  phone: string
  lines: IOpenTabLine[]
  status: 'open' | 'closed'
  closedSaleId?: Types.ObjectId | null
  openedBy?: Types.ObjectId | null
}

const openTabLineSchema = new Schema<IOpenTabLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    listUnitPrice: { type: Number, min: 0 },
    addedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    addedByDisplayName: { type: String, trim: true, maxlength: 120 },
    addedAt: { type: Date, default: null },
  },
  { _id: false },
)

const openTabSchema = new Schema<IOpenTab>(
  {
    kind: { type: String, enum: ['tab', 'job_card'], default: 'tab' },
    tabNumber: { type: String, required: true, trim: true },
    jobNumber: { type: String, trim: true, default: null },
    itemCheckedIn: { type: String, default: '', trim: true },
    jobDescription: { type: String, default: '', trim: true },
    attachmentNote: { type: String, default: '', trim: true },
    /** May be empty for job_card; tabs require name at API layer. */
    customerName: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    lines: { type: [openTabLineSchema], default: [] },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    closedSaleId: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
    openedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

openTabSchema.index(
  { tabNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
)

export const OpenTab = mongoose.model<IOpenTab>('OpenTab', openTabSchema)
