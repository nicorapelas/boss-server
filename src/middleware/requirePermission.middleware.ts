import type { RequestHandler } from 'express'
import { hasEveryPermission } from '../permissions/catalog.js'

/** User must have every listed permission (or admin / wildcard). */
export function requirePermission(...required: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    if (!hasEveryPermission(req.user.permissions, req.user.role, required)) {
      res.status(403).json({ message: 'Permission denied' })
      return
    }
    next()
  }
}
