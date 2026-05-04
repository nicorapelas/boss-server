import jwt, { type SignOptions } from 'jsonwebtoken'

export type AccessPayload = {
  sub: string
  email: string
  /** Role slug, e.g. admin, cashier */
  role: string
  permissions: string[]
  typ: 'access'
}
export type RefreshPayload = { sub: string; typ: 'refresh'; ver: number }

export function signAccessToken(
  user: { id: string; email: string; role: string; permissions: string[] },
  secret: string,
  expiresIn: SignOptions['expiresIn'] = '15m',
) {
  const payload: AccessPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    typ: 'access',
  }
  const options: SignOptions = { expiresIn }
  return jwt.sign(payload, secret, options)
}

export function signRefreshToken(userId: string, secret: string, expiresIn: SignOptions['expiresIn'] = '7d') {
  const payload: RefreshPayload = { sub: userId, typ: 'refresh', ver: 1 }
  const options: SignOptions = { expiresIn }
  return jwt.sign(payload, secret, options)
}

export function verifyAccessToken(token: string, secret: string) {
  const decoded = jwt.verify(token, secret) as AccessPayload
  if (decoded.typ !== 'access') throw new Error('invalid_token_type')
  return decoded
}

export function verifyRefreshToken(token: string, secret: string) {
  const decoded = jwt.verify(token, secret) as RefreshPayload
  if (decoded.typ !== 'refresh') throw new Error('invalid_token_type')
  return decoded
}
