import type { RequestHandler } from 'express'
import { verifyAccessToken } from '../utils/jwt.js'

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
      req.user = { id: payload.sub, email: payload.email, role: payload.role }
      next()
    } catch {
      res.status(401).json({ message: 'Invalid or expired access token' })
    }
  }
}
