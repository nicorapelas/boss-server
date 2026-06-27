import mongoose, { Schema, Types } from 'mongoose'

export type AttendanceClockMethod = 'badge' | 'face' | 'manual'
export type AttendanceClockOutMethod = AttendanceClockMethod | 'auto_sale'

export interface IStaffAttendanceSession {
  userId: Types.ObjectId
  status: 'open' | 'closed'
  clockInAt: Date
  clockOutAt?: Date | null
  clockInMethod: AttendanceClockMethod
  clockOutMethod?: AttendanceClockOutMethod | null
  tillCode?: string | null
}

const staffAttendanceSessionSchema = new Schema<IStaffAttendanceSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    clockInAt: { type: Date, required: true, default: () => new Date(), index: true },
    clockOutAt: { type: Date, default: null },
    clockInMethod: { type: String, enum: ['badge', 'face', 'manual'], required: true },
    clockOutMethod: { type: String, enum: ['badge', 'face', 'manual', 'auto_sale'], default: null },
    tillCode: { type: String, trim: true, uppercase: true, default: null },
  },
  { timestamps: true },
)

staffAttendanceSessionSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
)
staffAttendanceSessionSchema.index({ clockInAt: -1 })
staffAttendanceSessionSchema.index({ userId: 1, clockInAt: -1 })

export const StaffAttendanceSession = mongoose.model<IStaffAttendanceSession>(
  'StaffAttendanceSession',
  staffAttendanceSessionSchema,
)
