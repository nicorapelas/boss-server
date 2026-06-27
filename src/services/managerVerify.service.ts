import type { IRole } from '../models/Role.js'
import { Role } from '../models/Role.js'
import { User } from '../models/User.js'
import { hasPermission } from '../permissions/catalog.js'
import { coerceObjectId } from '../utils/objectId.js'
import {
  FACE_MODEL_ID,
  findBestFaceMatch,
  validateFaceEmbedding,
} from '../utils/faceMatch.js'
import { AuthError } from './auth.service.js'

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
  throw new AuthError(500, 'User role not loaded')
}

function permissionsForRole(role: IRole, user: { allowShopAssistCatalogAdjustment?: boolean }) {
  const permissions = new Set(role.permissions)
  if (user.allowShopAssistCatalogAdjustment) permissions.add('catalog.write')
  return [...permissions]
}

function assertStaffActive(
  active: boolean | undefined,
  roleSlug: string,
  source: 'vector' | undefined,
  canLogin: boolean | undefined,
) {
  if (active === false) throw new AuthError(403, 'Staff account is disabled')
  if (roleSlug !== 'admin' && source === 'vector' && canLogin === false) {
    throw new AuthError(403, 'Staff account is locked')
  }
}

function assertRegisterManager(role: IRole, permissions: string[]) {
  if (!hasPermission(permissions, role.slug, 'register.manager')) {
    throw new AuthError(403, 'POS manager approval required')
  }
}

function managerPayload(user: { _id: unknown; displayName?: string | null; email: string }) {
  return {
    userId: String(user._id),
    displayName: user.displayName?.trim() || user.email,
  }
}

export async function verifyPosManagerByBadge(badgeCode: string) {
  const normalized = badgeCode.trim()
  if (!normalized) throw new AuthError(400, 'badgeCode required')
  const user = await User.findOne({
    $or: [{ badgeCode: normalized }, { email: normalized.toLowerCase() }],
  }).populate<{ roleId: IRole }>('roleId')
  if (!user) throw new AuthError(401, 'Invalid badge')
  const role = await resolveUserRole(user)
  assertStaffActive(user.active, role.slug, user.legacy?.source, user.legacy?.canLogin)
  const permissions = permissionsForRole(role, user)
  assertRegisterManager(role, permissions)
  return managerPayload(user)
}

export async function verifyPosManagerByFace(embeddingRaw: unknown) {
  const probe = validateFaceEmbedding(embeddingRaw)
  if (!probe) throw new AuthError(400, 'Invalid face embedding')

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

  if (candidates.length === 0) throw new AuthError(401, 'No staff enrolled for face verification')

  const match = findBestFaceMatch(probe, candidates)
  if (!match) throw new AuthError(401, 'Face not recognized')

  const user = await User.findById(match.userId).populate<{ roleId: IRole }>('roleId')
  if (!user) throw new AuthError(401, 'Face not recognized')
  const role = await resolveUserRole(user)
  assertStaffActive(user.active, role.slug, user.legacy?.source, user.legacy?.canLogin)
  const permissions = permissionsForRole(role, user)
  assertRegisterManager(role, permissions)
  return managerPayload(user)
}
