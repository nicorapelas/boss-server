import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createRole,
  deleteRole,
  listPermissionCatalog,
  listRoles,
  updateRole,
} from '../controllers/roles.controller.js'

export function rolesRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/catalog', requireAuth, requirePermission('users.manage'), listPermissionCatalog)
  r.get('/', requireAuth, requirePermission('users.manage'), listRoles)
  r.post('/', requireAuth, requirePermission('users.manage'), createRole)
  r.patch('/:id', requireAuth, requirePermission('users.manage'), updateRole)
  r.delete('/:id', requireAuth, requirePermission('users.manage'), deleteRole)
  return r
}
