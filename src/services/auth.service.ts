import bcrypt from 'bcryptjs'
import type { IRole } from '../models/Role.js'
import { Role } from '../models/Role.js'
import { User, hashPassword } from '../models/User.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js'
import { hashToken } from '../utils/tokenHash.js'

export class AuthError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function roleFromUser(user: { roleId: unknown }): IRole {
  const r = user.roleId as IRole | null
  if (!r || typeof r !== 'object' || !('slug' in r)) {
    throw new AuthError(500, 'User role not loaded')
  }
  return r
}

export async function registerUser(email: string, password: string, roleSlug: 'admin' | 'cashier' = 'cashier') {
  const role = await Role.findOne({ slug: roleSlug })
  if (!role) throw new AuthError(500, 'Roles not bootstrapped')
  const passwordHash = await hashPassword(password)
  const user = await User.create({ email, passwordHash, roleId: role._id })
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
  const r = roleFromUser(user)
  assertUserLoginAllowed(user.active, r.slug, user.legacy?.source, user.legacy?.canLogin)
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw new AuthError(401, 'Invalid credentials')
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
  const r = roleFromUser(user)
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
  if (!user?.refreshTokenHash || !user.refreshTokenExpires) {
    throw new AuthError(401, 'Session expired')
  }
  if (user.refreshTokenExpires.getTime() < Date.now()) {
    throw new AuthError(401, 'Session expired')
  }
  const matches = user.refreshTokenHash === hashToken(refreshToken)
  if (!matches) throw new AuthError(401, 'Invalid refresh token')

  const r = roleFromUser(user)
  const accessToken = signAccessToken(
    {
      id: user.id,
      email: user.email,
      role: r.slug,
      permissions: r.permissions,
    },
    accessSecret,
  )
  const newRefresh = signRefreshToken(user.id, refreshSecret)
  user.refreshTokenHash = hashToken(newRefresh)
  user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await user.save()

  return {
    accessToken,
    refreshToken: newRefresh,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: r.slug,
      permissions: r.permissions,
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
  const accessToken = signAccessToken(
    {
      id: userId,
      email: user.email,
      role: role.slug,
      permissions: role.permissions,
    },
    accessSecret,
  )
  const refreshToken = signRefreshToken(userId, refreshSecret)
  user.refreshTokenHash = hashToken(refreshToken)
  user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await user.save()

  return {
    accessToken,
    refreshToken,
    user: {
      id: userId,
      email: user.email,
      displayName: user.displayName ?? undefined,
      role: role.slug,
      permissions: role.permissions,
    },
  }
}
