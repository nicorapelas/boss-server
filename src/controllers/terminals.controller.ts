import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import { PosTerminal } from '../models/PosTerminal.js'
import { ShiftSession } from '../models/ShiftSession.js'
import { User } from '../models/User.js'

export const TERMINAL_ONLINE_THRESHOLD_MS = 120_000

function normalizeTillCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase()
  if (!v || !/^[A-Z0-9_-]{1,24}$/.test(v)) return null
  return v
}

function clientIp(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown'
  return String(raw).replace(/^::ffff:/, '')
}

function serializeTerminal(
  doc: {
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
    createdAt?: Date
    updatedAt?: Date
  },
  openShift: { _id: Types.ObjectId; openedAt: Date } | null,
  now = Date.now(),
) {
  const lastSeenMs = doc.lastSeenAt instanceof Date ? doc.lastSeenAt.getTime() : new Date(doc.lastSeenAt).getTime()
  const online = now - lastSeenMs <= TERMINAL_ONLINE_THRESHOLD_MS
  return {
    tillCode: doc.tillCode,
    displayName: doc.displayName?.trim() || undefined,
    lastSeenAt: doc.lastSeenAt instanceof Date ? doc.lastSeenAt.toISOString() : String(doc.lastSeenAt),
    lastIp: doc.lastIp?.trim() || undefined,
    appVersion: doc.appVersion?.trim() || undefined,
    platform: doc.platform?.trim() || undefined,
    hostname: doc.hostname?.trim() || undefined,
    cashierUserId: doc.cashierUserId ? String(doc.cashierUserId) : undefined,
    cashierDisplayName: doc.cashierDisplayName?.trim() || undefined,
    catalogRevision: typeof doc.catalogRevision === 'number' ? doc.catalogRevision : undefined,
    online,
    openShiftId: openShift ? String(openShift._id) : undefined,
    openShiftOpenedAt: openShift?.openedAt
      ? openShift.openedAt instanceof Date
        ? openShift.openedAt.toISOString()
        : String(openShift.openedAt)
      : undefined,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : undefined,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : undefined,
  }
}

/** POS — register / refresh terminal presence while signed in. */
export async function heartbeatTerminal(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const body = req.body as {
      tillCode?: string
      appVersion?: string
      platform?: string
      hostname?: string
      catalogRevision?: number
    }
    const tillCode = normalizeTillCode(body.tillCode)
    if (!tillCode) {
      res.status(400).json({ message: 'Invalid tillCode' })
      return
    }

    const user = await User.findById(req.user.id).select({ displayName: 1, email: 1 }).lean()
    const cashierDisplayName =
      (typeof user?.displayName === 'string' && user.displayName.trim()) ||
      (typeof user?.email === 'string' && user.email.trim()) ||
      undefined

    const catalogRevision =
      body.catalogRevision !== undefined && Number.isFinite(Number(body.catalogRevision))
        ? Math.max(0, Math.floor(Number(body.catalogRevision)))
        : undefined

    const set: Record<string, unknown> = {
      tillCode,
      lastSeenAt: new Date(),
      lastIp: clientIp(req),
      cashierUserId: new Types.ObjectId(String(req.user.id)),
      cashierDisplayName,
    }
    if (body.appVersion !== undefined) set.appVersion = String(body.appVersion).trim().slice(0, 32)
    if (body.platform !== undefined) set.platform = String(body.platform).trim().slice(0, 32)
    if (body.hostname !== undefined) set.hostname = String(body.hostname).trim().slice(0, 120)
    if (catalogRevision !== undefined) set.catalogRevision = catalogRevision

    const doc = await PosTerminal.findOneAndUpdate(
      { tillCode },
      { $set: set, $setOnInsert: { displayName: tillCode } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean()

    if (!doc) {
      res.status(500).json({ message: 'Terminal heartbeat failed' })
      return
    }

    const openShift = await ShiftSession.findOne({ tillCode, status: 'open' })
      .select({ openedAt: 1 })
      .sort({ openedAt: -1 })
      .lean()

    res.json(
      serializeTerminal(
        doc,
        openShift ? { _id: openShift._id as Types.ObjectId, openedAt: openShift.openedAt } : null,
      ),
    )
  } catch (e) {
    next(e)
  }
}

/** Back Office — list known terminals with online status. */
export async function listTerminals(_req: Request, res: Response, next: NextFunction) {
  try {
    const docs = await PosTerminal.find().sort({ tillCode: 1 }).lean()
    const tillCodes = docs.map((d) => d.tillCode)
    const openShifts = tillCodes.length
      ? await ShiftSession.find({ tillCode: { $in: tillCodes }, status: 'open' })
          .select({ tillCode: 1, openedAt: 1 })
          .lean()
      : []
    const openByTill = new Map(
      openShifts.map((s) => [String(s.tillCode), { _id: s._id as Types.ObjectId, openedAt: s.openedAt }]),
    )
    const now = Date.now()
    res.json(
      docs.map((d) =>
        serializeTerminal(d, openByTill.get(String(d.tillCode)) ?? null, now),
      ),
    )
  } catch (e) {
    next(e)
  }
}

/** Back Office — friendly name for a till. */
export async function updateTerminal(req: Request, res: Response, next: NextFunction) {
  try {
    const tillCode = normalizeTillCode(req.params.tillCode)
    if (!tillCode) {
      res.status(400).json({ message: 'Invalid tillCode' })
      return
    }
    const body = req.body as { displayName?: string }
    if (body.displayName === undefined) {
      res.status(400).json({ message: 'displayName required' })
      return
    }
    const displayName = String(body.displayName).trim().slice(0, 80)
    const doc = await PosTerminal.findOneAndUpdate(
      { tillCode },
      { $set: { displayName: displayName || tillCode } },
      { new: true },
    ).lean()
    if (!doc) {
      res.status(404).json({ message: 'Terminal not found — till must check in from POS first' })
      return
    }
    const openShift = await ShiftSession.findOne({ tillCode, status: 'open' })
      .select({ openedAt: 1 })
      .sort({ openedAt: -1 })
      .lean()
    res.json(
      serializeTerminal(
        doc,
        openShift ? { _id: openShift._id as Types.ObjectId, openedAt: openShift.openedAt } : null,
      ),
    )
  } catch (e) {
    next(e)
  }
}
