import type { RequestHandler } from 'express'
import { hasAnyPermission } from '../permissions/catalog.js'

/** User must have at least one of the listed permissions (or admin / wildcard). */
export function requireAnyPermission(...required: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    if (!hasAnyPermission(req.user.permissions, req.user.role, required)) {
      res.status(403).json({ message: 'Permission denied' })
      return
    }
    next()
  }
}
