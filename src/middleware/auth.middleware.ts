import type { RequestHandler } from 'express'
import { verifyAccessToken } from '../utils/jwt.js'
import {
  CASHIER_PERMISSION_IDS,
  MANAGER_PERMISSION_IDS,
  PERMISSION_WILDCARD,
} from '../permissions/catalog.js'

export function requireAuth(accessSecret: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) {
      res.status(401).json({ message: 'Missing bearer token' })
      return
    }
    try {
      const payload = verifyAccessToken(token, accessSecret)
      let permissions = payload.permissions
      if (!Array.isArray(permissions) || permissions.length === 0) {
        // Legacy tokens issued before permissions were embedded
        if (payload.role === 'admin') {
          permissions = [PERMISSION_WILDCARD]
        } else if (payload.role === 'manager') {
          permissions = [...MANAGER_PERMISSION_IDS]
        } else {
          permissions = [...CASHIER_PERMISSION_IDS]
        }
      }
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        permissions,
      }
      next()
    } catch {
      res.status(401).json({ message: 'Invalid or expired access token' })
    }
  }
}
