import mongoose, { Schema, Types } from 'mongoose'

export interface IOfflineSyncConflictLine {
  productId: string
  name: string
  qty: number
}

export interface IOfflineSyncConflict {
  clientLocalId: string
  tillCode?: string
  scope: 'offline' | 'online'
  errorMessage: string
  status: 'open' | 'resolved'
  firstSeenAt: Date
  lastSeenAt: Date
  resolvedAt?: Date | null
  resolvedBy?: Types.ObjectId | null
  resolutionAction?: 'stock_adjusted' | 'sale_retried' | 'waived' | 'other' | null
  resolutionNote?: string | null
  retryRequestedAt?: Date | null
  retryRequestedBy?: Types.ObjectId | null
  lines: IOfflineSyncConflictLine[]
  attemptCount: number
}

const offlineSyncConflictLineSchema = new Schema<IOfflineSyncConflictLine>(
  {
    productId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 0.0001 },
  },
  { _id: false },
)

const offlineSyncConflictSchema = new Schema<IOfflineSyncConflict>(
  {
    clientLocalId: { type: String, required: true, trim: true, unique: true, index: true },
    tillCode: { type: String, trim: true, index: true },
    scope: { type: String, enum: ['offline', 'online'], required: true, default: 'offline' },
    errorMessage: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ['open', 'resolved'], required: true, default: 'open', index: true },
    firstSeenAt: { type: Date, required: true, default: Date.now },
    lastSeenAt: { type: Date, required: true, default: Date.now, index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolutionAction: {
      type: String,
      enum: ['stock_adjusted', 'sale_retried', 'waived', 'other'],
      default: null,
      index: true,
    },
    resolutionNote: { type: String, trim: true, maxlength: 500, default: null },
    retryRequestedAt: { type: Date, default: null, index: true },
    retryRequestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lines: { type: [offlineSyncConflictLineSchema], required: true, default: [] },
    attemptCount: { type: Number, required: true, min: 1, default: 1 },
  },
  { timestamps: true },
)

offlineSyncConflictSchema.index({ status: 1, lastSeenAt: -1 })

export const OfflineSyncConflict = mongoose.model<IOfflineSyncConflict>('OfflineSyncConflict', offlineSyncConflictSchema)
