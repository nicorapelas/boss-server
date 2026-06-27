import type { IRole } from '../models/Role.js'
import { Role } from '../models/Role.js'
import { User } from '../models/User.js'
import {
  StaffAttendanceSession,
  type AttendanceClockMethod,
  type IStaffAttendanceSession,
} from '../models/StaffAttendanceSession.js'
import { ensureStoreSettingsDoc } from '../controllers/storeSettings.controller.js'
import { attendanceFromSettings, isAfterAutoClockOutTime } from '../utils/attendanceSettings.js'
import {
  FACE_MODEL_ID,
  findBestFaceMatch,
  validateFaceEmbedding,
} from '../utils/faceMatch.js'
import { coerceObjectId } from '../utils/objectId.js'

export class AttendanceError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function serializeSession(doc: IStaffAttendanceSession & { _id?: { toString(): string } }) {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    status: doc.status,
    clockInAt: doc.clockInAt instanceof Date ? doc.clockInAt.toISOString() : String(doc.clockInAt),
    clockOutAt:
      doc.clockOutAt instanceof Date
        ? doc.clockOutAt.toISOString()
        : doc.clockOutAt
          ? String(doc.clockOutAt)
          : null,
    clockInMethod: doc.clockInMethod,
    clockOutMethod: doc.clockOutMethod ?? null,
    tillCode: doc.tillCode ?? null,
  }
}

async function resolveUserRole(user: { roleId: unknown }): Promise<IRole> {
  const populated = user.roleId as IRole | null
  if (
    populated &&
    typeof populated === 'object' &&
    typeof populated.slug === 'string' &&
    Array.isArray(populated.permissions)
  ) {
    return populated
  }

  const roleId = coerceObjectId(user.roleId)
  if (roleId) {
    const byId = await Role.findById(roleId)
    if (byId) return byId
  }

  throw new AttendanceError(500, 'User role not loaded')
}

function assertStaffEligible(
  active: boolean | undefined,
  roleSlug: string,
  source: 'vector' | undefined,
  canLogin: boolean | undefined,
) {
  if (active === false) throw new AttendanceError(403, 'Staff account is disabled')
  if (roleSlug !== 'admin' && source === 'vector' && canLogin === false) {
    throw new AttendanceError(403, 'Staff account is locked')
  }
}

async function ensureAttendanceEnabled() {
  const settings = await ensureStoreSettingsDoc()
  const attendance = attendanceFromSettings(settings as Parameters<typeof attendanceFromSettings>[0])
  if (!attendance.enabled) {
    throw new AttendanceError(403, 'Staff attendance is disabled for this store')
  }
  return attendance
}

export async function resolveStaffByBadge(badgeCode: string) {
  const normalized = badgeCode.trim()
  if (!normalized) throw new AttendanceError(400, 'badgeCode required')
  const user = await User.findOne({
    $or: [{ badgeCode: normalized }, { email: normalized.toLowerCase() }],
  }).populate<{ roleId: IRole }>('roleId')
  if (!user) throw new AttendanceError(401, 'Invalid badge')
  const role = await resolveUserRole(user)
  assertStaffEligible(user.active, role.slug, user.legacy?.source, user.legacy?.canLogin)
  return user
}

export async function resolveStaffByFace(embeddingRaw: unknown) {
  const probe = validateFaceEmbedding(embeddingRaw)
  if (!probe) throw new AttendanceError(400, 'Invalid face embedding')

  const enrolled = await User.find({
    active: { $ne: false },
    'faceEnrollment.embedding.0': { $exists: true },
    'faceEnrollment.modelId': FACE_MODEL_ID,
  })
    .select({ faceEnrollment: 1 })
    .lean()

  const candidates = enrolled
    .map((u) => {
      const emb = u.faceEnrollment?.embedding
      if (!Array.isArray(emb) || emb.length === 0) return null
      return { userId: String(u._id), embedding: emb }
    })
    .filter((c): c is { userId: string; embedding: number[] } => c != null)

  if (candidates.length === 0) throw new AttendanceError(401, 'No staff enrolled for face clock')

  const match = findBestFaceMatch(probe, candidates)
  if (!match) throw new AttendanceError(401, 'Face not recognized')

  const user = await User.findById(match.userId).populate<{ roleId: IRole }>('roleId')
  if (!user) throw new AttendanceError(401, 'Face not recognized')
  const role = await resolveUserRole(user)
  assertStaffEligible(user.active, role.slug, user.legacy?.source, user.legacy?.canLogin)
  return user
}

async function clockInForUser(
  userId: string,
  method: AttendanceClockMethod,
  tillCode?: string | null,
) {
  const open = await StaffAttendanceSession.findOne({ userId, status: 'open' })
  if (open) {
    throw new AttendanceError(409, 'Already clocked in')
  }

  const session = await StaffAttendanceSession.create({
    userId,
    status: 'open',
    clockInAt: new Date(),
    clockInMethod: method,
    tillCode: tillCode?.trim().toUpperCase().slice(0, 24) || null,
  })
  return { action: 'clock_in' as const, session: serializeSession(session) }
}

function staffDisplayName(user: { displayName?: string | null; email: string }) {
  return user.displayName?.trim() || user.email
}

export async function clockByBadge(badgeCode: string, tillCode?: string | null) {
  await ensureAttendanceEnabled()
  const user = await resolveStaffByBadge(badgeCode)
  const result = await clockInForUser(String(user._id), 'badge', tillCode)
  return {
    ...result,
    displayName: staffDisplayName(user),
    userId: String(user._id),
  }
}

export async function clockByFace(embeddingRaw: unknown, tillCode?: string | null) {
  await ensureAttendanceEnabled()
  const user = await resolveStaffByFace(embeddingRaw)
  const result = await clockInForUser(String(user._id), 'face', tillCode)
  return {
    ...result,
    displayName: staffDisplayName(user),
    userId: String(user._id),
  }
}

/** Active staff who can clock in but do not have an open attendance session. */
export async function getPendingClockInStaff() {
  const settings = await ensureStoreSettingsDoc()
  const attendance = attendanceFromSettings(settings as Parameters<typeof attendanceFromSettings>[0])
  if (!attendance.enabled) {
    return { pending: [] as Array<{ id: string; displayName: string; roleName?: string }> }
  }

  const openSessions = await StaffAttendanceSession.find({ status: 'open' }).select('userId').lean()
  const clockedInIds = new Set(openSessions.map((s) => String(s.userId)))

  const users = await User.find({
    active: { $ne: false },
    $or: [
      { badgeCode: { $exists: true, $nin: [null, ''] } },
      { 'faceEnrollment.embedding.0': { $exists: true } },
    ],
  })
    .select({ displayName: 1, email: 1, roleId: 1, legacy: 1, active: 1 })
    .populate<{ roleId: IRole }>('roleId')
    .lean()

  const pending: Array<{ id: string; displayName: string; roleName?: string }> = []
  for (const user of users) {
    const id = String(user._id)
    if (clockedInIds.has(id)) continue
    const role = user.roleId as IRole | null
    const roleSlug = role && typeof role === 'object' && typeof role.slug === 'string' ? role.slug : ''
    try {
      assertStaffEligible(user.active, roleSlug, user.legacy?.source, user.legacy?.canLogin)
    } catch {
      continue
    }
    pending.push({
      id,
      displayName: staffDisplayName(user),
      roleName: role && typeof role === 'object' && typeof role.name === 'string' ? role.name : undefined,
    })
  }

  pending.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
  return { pending }
}

export async function clockOutSelf(userId: string) {
  await ensureAttendanceEnabled()
  const open = await StaffAttendanceSession.findOne({ userId, status: 'open' })
  if (!open) {
    throw new AttendanceError(409, 'Not clocked in')
  }
  open.status = 'closed'
  open.clockOutAt = new Date()
  open.clockOutMethod = 'manual'
  await open.save()
  return { session: serializeSession(open) }
}

export async function getMyAttendanceStatus(userId: string) {
  const settings = await ensureStoreSettingsDoc()
  const attendance = attendanceFromSettings(settings as Parameters<typeof attendanceFromSettings>[0])
  const open = await StaffAttendanceSession.findOne({ userId, status: 'open' }).lean()
  const clockInAt = open?.clockInAt
  const elapsedMinutes =
    clockInAt instanceof Date
      ? Math.max(0, Math.floor((Date.now() - clockInAt.getTime()) / 60_000))
      : 0
  return {
    clockedIn: Boolean(open),
    clockInAt: clockInAt instanceof Date ? clockInAt.toISOString() : null,
    elapsedMinutes,
    attendance,
  }
}

export function shouldPromptClockOutOnLogout(
  status: Awaited<ReturnType<typeof getMyAttendanceStatus>>,
): boolean {
  if (!status.attendance.enabled || !status.attendance.logoutClockOutPromptEnabled) return false
  if (!status.clockedIn) return false
  const minMinutes = status.attendance.logoutPromptAfterMinutes
  if (minMinutes <= 0) return true
  return status.elapsedMinutes >= minMinutes
}

/**
 * If auto clock-out is enabled and the cashier is still clocked in after the cutoff,
 * close their session using the sale timestamp as clock-out time.
 */
export async function maybeAutoClockOutOnSale(userId: string, saleAt: Date) {
  const settings = await ensureStoreSettingsDoc()
  const attendance = attendanceFromSettings(settings as Parameters<typeof attendanceFromSettings>[0])
  if (!attendance.enabled || !attendance.autoClockOutEnabled) return null
  if (!isAfterAutoClockOutTime(saleAt, attendance.autoClockOutTime)) return null

  const open = await StaffAttendanceSession.findOne({ userId, status: 'open' })
  if (!open) return null

  open.status = 'closed'
  open.clockOutAt = saleAt
  open.clockOutMethod = 'auto_sale'
  await open.save()
  return { session: serializeSession(open) }
}
