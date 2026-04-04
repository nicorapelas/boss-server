import bcrypt from 'bcryptjs'
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

export async function registerUser(email: string, password: string, role: 'admin' | 'cashier' = 'cashier') {
  const passwordHash = await hashPassword(password)
  const user = await User.create({ email, passwordHash, role })
  return user
}

export async function loginUser(
  email: string,
  password: string,
  accessSecret: string,
  refreshSecret: string,
) {
  const user = await User.findOne({ email: email.toLowerCase() })
  if (!user) throw new AuthError(401, 'Invalid credentials')
  assertUserLoginAllowed(user.active, user.role, user.legacy?.source, user.legacy?.canLogin)
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw new AuthError(401, 'Invalid credentials')
  return createSessionForUser(user, accessSecret, refreshSecret)
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
  })
  if (!user) throw new AuthError(401, 'Invalid badge')
  assertUserLoginAllowed(user.active, user.role, user.legacy?.source, user.legacy?.canLogin)
  return createSessionForUser(user, accessSecret, refreshSecret)
}

export async function refreshSession(refreshToken: string, accessSecret: string, refreshSecret: string) {
  let payload
  try {
    payload = verifyRefreshToken(refreshToken, refreshSecret)
  } catch {
    throw new AuthError(401, 'Invalid refresh token')
  }

  const user = await User.findById(payload.sub)
  if (!user?.refreshTokenHash || !user.refreshTokenExpires) {
    throw new AuthError(401, 'Session expired')
  }
  if (user.refreshTokenExpires.getTime() < Date.now()) {
    throw new AuthError(401, 'Session expired')
  }
  const matches = user.refreshTokenHash === hashToken(refreshToken)
  if (!matches) throw new AuthError(401, 'Invalid refresh token')

  const accessToken = signAccessToken(
    { id: user.id, email: user.email, role: user.role },
    accessSecret,
  )
  const newRefresh = signRefreshToken(user.id, refreshSecret)
  user.refreshTokenHash = hashToken(newRefresh)
  user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await user.save()

  return {
    accessToken,
    refreshToken: newRefresh,
    user: { id: user.id, email: user.email, role: user.role },
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
  role: 'admin' | 'cashier',
  source: 'vector' | undefined,
  canLogin: boolean | undefined,
) {
  if (active === false) throw new AuthError(403, 'User account is disabled')
  if (role !== 'admin' && source === 'vector' && canLogin === false) {
    throw new AuthError(403, 'User login is locked. Ask admin to unlock.')
  }
}

async function createSessionForUser(
  user: {
    id?: string
    _id?: { toString: () => string } | string
    email: string
    role: 'admin' | 'cashier'
    refreshTokenHash?: string | null
    refreshTokenExpires?: Date | null
    save: () => Promise<unknown>
  },
  accessSecret: string,
  refreshSecret: string,
) {
  const userId = user.id ?? (typeof user._id === 'string' ? user._id : user._id?.toString() ?? '')
  if (!userId) {
    throw new AuthError(500, 'User id missing')
  }
  const accessToken = signAccessToken(
    { id: userId, email: user.email, role: user.role },
    accessSecret,
  )
  const refreshToken = signRefreshToken(userId, refreshSecret)
  user.refreshTokenHash = hashToken(refreshToken)
  user.refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await user.save()

  return {
    accessToken,
    refreshToken,
    user: { id: userId, email: user.email, role: user.role },
  }
}
