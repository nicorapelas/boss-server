import { Types } from 'mongoose'

/** Coerce backup/JSON values into a Mongo ObjectId (or null if not possible). */
export function coerceObjectId(value: unknown): Types.ObjectId | null {
  if (value instanceof Types.ObjectId) return value
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value)
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.$oid === 'string' && Types.ObjectId.isValid(o.$oid)) {
      return new Types.ObjectId(o.$oid)
    }
    if (o._id !== undefined) return coerceObjectId(o._id)
  }
  return null
}
