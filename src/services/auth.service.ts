import bcrypt from 'bcryptjs'
import type { IRole } from '../models/Role.js'
import { Role } from '../models/Role.js'
import { User, hashPassword } from '../models/User.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js'
import { REFRESH_TOKEN_DB_MS } from '../config/authSession.js'
import { coerceObjectId } from '../utils/objectId.js'
import { hashToken } from '../utils/tokenHash.js'
import {
  FACE_MODEL_ID,
  findBestFaceMatch,
  validateFaceEmbedding,
} from '../utils/faceMatch.js'
import { ensureStoreSettingsDoc } from '../controllers/storeSettings.controller.js'
import { posLoginMethodFromSettings } from '../utils/posLoginMethod.js'

export class AuthError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function permissionsForSession(role: IRole, user: { allowShopAssistCatalogAdjustment?: boolean }) {
  const permissions = new Set(role.permissions)
  if (user.allowShopAssistCatalogAdjustment) permissions.add('catalog.write')
  return [...permissions]
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

  if (user.roleId && typeof user.roleId === 'object' && 'slug' in user.roleId) {
    const slug = String((user.roleId as { slug?: string }).slug ?? '').toLowerCase()
    if (slug) {
      const bySlug = await Role.findOne({ slug })
      if (bySlug) return bySlug
    }
  }

  throw new AuthError(500, 'User role not loaded')
}

export async function registerUser(email: string, password: string, roleSlug: 'admin' | 'cashier' = 'cashier') {
  const role = await Role.findOne({ slug: roleSlug })
  if (!role) throw new AuthError(500, 'Roles not bootstrapped')
  const passwordHash = await hashPassword(password)
  const user = await User.create({ email, passwordHash, roleId: role._id, allowOfflineLogin: false })
  await user.populate<{ roleId: IRole }>('roleId')
  return user
}

export async function loginUser(
  email: string,
  password: string,
  accessSecret: string,
  refreshSecret: string,
) {
  const user = await User.findOne({ email: email.toLowerCase() }).populate<{ roleId: IRole }>('roleId')
  if (!user) throw new AuthError(401, 'Invalid credentials')
  const r = await resolveUserRole(user)
  assertUserLoginAllowed(user.active, r.slug, user.legacy?.source, user.legacy?.canLogin)
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw new AuthError(401, 'Invalid credentials')
  return createSessionForUser(user, r, accessSecret, refreshSecret)
}

export async function loginByFace(
  embeddingRaw: unknown,
  accessSecret: string,
  refreshSecret: string,
) {
  const settings = await ensureStoreSettingsDoc()
  if (posLoginMethodFromSettings(settings) !== 'face') {
    throw new AuthError(403, 'Face login is disabled for this store')
  }

  const probe = validateFaceEmbedding(embeddingRaw)
  if (!probe) throw new AuthError(400, 'Invalid face embedding')

  const enrolled = await User.find({
    active: { $ne: false },
    'faceEnrollment.embedding.0': { $exists: true },
    'faceEnrollment.modelId': FACE_MODEL_ID,
  })
    .select({ faceEnrollment: 1 })
    .populate<{ roleId: IRole }>('roleId')
    .lean()

  const candidates = enrolled
    .map((u) => {
      const emb = u.faceEnrollment?.embedding
      if (!Array.isArray(emb) || emb.length === 0) return null
      return { userId: String(u._id), embedding: emb }
    })
    .filter((c): c is { userId: string; embedding: number[] } => c != null)

  if (candidates.length === 0) throw new AuthError(401, 'No staff enrolled for face login')

  const match = findBestFaceMatch(probe, candidates)
  if (!match) throw new AuthError(401, 'Face not recognized')

  const user = await User.findById(match.userId).populate<{ roleId: IRole }>('roleId')
  if (!user) throw new AuthError(401, 'Face not recognized')
  const r = await resolveUserRole(user)
  assertUserLoginAllowed(user.active, r.slug, user.legacy?.source, user.legacy?.canLogin)
  return createSessionForUser(user, r, accessSecret, refreshSecret)
}

export async function loginByBadge(
  badgeCode: string,
  accessSecret: string,
  refreshSecret: string,
) {
  const normalized = badgeCode.trim()
  if (!normalized) throw new AuthError(400, 'badgeCode required')
  const user = await User.findOne({
    $or: [{ badgeCode: normalized }, { email: normalized.toLowerCase() }],
  }).populate<{ roleId: IRole }>('roleId')
  if (!user) throw new AuthError(401, 'Invalid badge')
  const r = await resolveUserRole(user)
  assertUserLoginAllowed(user.active, r.slug, user.legacy?.source, user.legacy?.canLogin)
  return createSessionForUser(user, r, accessSecret, refreshSecret)
}

export async function refreshSession(refreshToken: string, accessSecret: string, refreshSecret: string) {
  let payload
  try {
    payload = verifyRefreshToken(refreshToken, refreshSecret)
  } catch {
    throw new AuthError(401, 'Invalid refresh token')
  }

  const user = await User.findById(payload.sub).populate<{ roleId: IRole }>('roleId')
  if (!user?.refreshTokenHash) {
    throw new AuthError(401, 'Session expired')
  }
  const matches = user.refreshTokenHash === hashToken(refreshToken)
  if (!matches) throw new AuthError(401, 'Invalid refresh token')

  const r = await resolveUserRole(user)
  const permissions = permissionsForSession(r, user)
  const accessToken = signAccessToken(
    {
      id: user.id,
      email: user.email,
      role: r.slug,
      permissions,
    },
    accessSecret,
  )

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: r.slug,
      permissions,
      allowOfflineLogin: Boolean((user as { allowOfflineLogin?: boolean }).allowOfflineLogin),
      allowShopAssistCatalogAdjustment: Boolean(user.allowShopAssistCatalogAdjustment),
    },
  }
}

export async function logoutUser(userId: string) {
  await User.findByIdAndUpdate(userId, {
    refreshTokenHash: null,
    refreshTokenExpires: null,
  })
}

function assertUserLoginAllowed(
  active: boolean | undefined,
  roleSlug: string,
  source: 'vector' | undefined,
  canLogin: boolean | undefined,
) {
  if (active === false) throw new AuthError(403, 'User account is disabled')
  if (roleSlug !== 'admin' && source === 'vector' && canLogin === false) {
    throw new AuthError(403, 'User login is locked. Ask admin to unlock.')
  }
}

async function createSessionForUser(
  user: {
    id?: string
    _id?: { toString: () => string } | string
    email: string
    displayName?: string | null
    allowShopAssistCatalogAdjustment?: boolean
    refreshTokenHash?: string | null
    refreshTokenExpires?: Date | null
    save: () => Promise<unknown>
  },
  role: IRole,
  accessSecret: string,
  refreshSecret: string,
) {
  const userId = user.id ?? (typeof user._id === 'string' ? user._id : user._id?.toString() ?? '')
  if (!userId) {
    throw new AuthError(500, 'User id missing')
  }
  const permissions = permissionsForSession(role, user)
  const accessToken = signAccessToken(
    {
      id: userId,
      email: user.email,
      role: role.slug,
      permissions,
    },
    accessSecret,
  )
  const refreshToken = signRefreshToken(userId, refreshSecret)
  user.refreshTokenHash = hashToken(refreshToken)
  user.refreshTokenExpires = new Date(Date.now() + REFRESH_TOKEN_DB_MS)
  await user.save()

  return {
    accessToken,
    refreshToken,
    user: {
      id: userId,
      email: user.email,
      displayName: user.displayName ?? undefined,
      role: role.slug,
      permissions,
      allowOfflineLogin: Boolean((user as { allowOfflineLogin?: boolean }).allowOfflineLogin),
      allowShopAssistCatalogAdjustment: Boolean(user.allowShopAssistCatalogAdjustment),
    },
  }
}
