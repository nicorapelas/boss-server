import mongoose, { Schema, Types } from 'mongoose'

/** Last-known POS workstation registered via heartbeat (keyed by till code). */
export interface IPosTerminal {
  /** Till code — same value as POS `VITE_POS_TILL_CODE` (e.g. T1). */
  tillCode: string
  displayName?: string
  lastSeenAt: Date
  lastIp?: string
  appVersion?: string
  platform?: string
  hostname?: string
  cashierUserId?: Types.ObjectId | null
  cashierDisplayName?: string
  catalogRevision?: number
}

const posTerminalSchema = new Schema<IPosTerminal>(
  {
    tillCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
    displayName: { type: String, trim: true, maxlength: 80 },
    lastSeenAt: { type: Date, required: true },
    lastIp: { type: String, trim: true, maxlength: 64 },
    appVersion: { type: String, trim: true, maxlength: 32 },
    platform: { type: String, trim: true, maxlength: 32 },
    hostname: { type: String, trim: true, maxlength: 120 },
    cashierUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cashierDisplayName: { type: String, trim: true, maxlength: 120 },
    catalogRevision: { type: Number, min: 0 },
  },
  { timestamps: true },
)

posTerminalSchema.index({ tillCode: 1 }, { unique: true })
posTerminalSchema.index({ lastSeenAt: -1 })

export const PosTerminal = mongoose.model<IPosTerminal>('PosTerminal', posTerminalSchema)
