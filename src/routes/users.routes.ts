import { Router, type RequestHandler } from 'express'
import {
  createUser,
  deleteUser,
  listUsers,
  setUserPassword,
  updateUser,
} from '../controllers/users.controller.js'

export function usersRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requireAdmin, listUsers)
  r.post('/', requireAuth, requireAdmin, createUser)
  r.patch('/:id', requireAuth, requireAdmin, updateUser)
  r.post('/:id/set-password', requireAuth, requireAdmin, setUserPassword)
  r.delete('/:id', requireAuth, requireAdmin, deleteUser)
  return r
}

