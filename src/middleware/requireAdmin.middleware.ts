import type { RequestHandler } from 'express'

/** Only users with role slug `admin` (not managers or permission-based overrides). */
export function requireAdmin(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    if (req.user.role !== 'admin') {
      res.status(403).json({ message: 'Admin only' })
      return
    }
    next()
  }
}
