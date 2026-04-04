import type { ErrorRequestHandler } from 'express'
import mongoose from 'mongoose'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ message: err.message })
    return
  }
  if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
    res.status(409).json({ message: 'Duplicate key' })
    return
  }
  const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : 500
  const message =
    typeof err === 'object' && err && 'message' in err ? String((err as Error).message) : 'Server error'
  res.status(Number.isFinite(status) ? status : 500).json({ message })
}
