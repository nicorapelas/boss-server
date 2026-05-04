import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createUser,
  deleteUser,
  listUsers,
  setUserPassword,
  updateUser,
} from '../controllers/users.controller.js'

export function usersRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requirePermission('users.manage'), listUsers)
  r.post('/', requireAuth, requirePermission('users.manage'), createUser)
  r.patch('/:id', requireAuth, requirePermission('users.manage'), updateUser)
  r.post('/:id/set-password', requireAuth, requirePermission('users.manage'), setUserPassword)
  r.delete('/:id', requireAuth, requirePermission('users.manage'), deleteUser)
  return r
}
