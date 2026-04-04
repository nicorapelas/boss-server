import { Router, type RequestHandler } from 'express'
import { login, loginBadge, logout, refresh, register } from '../controllers/auth.controller.js'

export function authRouter(requireAuthMw: RequestHandler) {
  const r = Router()
  r.post('/register', register)
  r.post('/login', login)
  r.post('/login-badge', loginBadge)
  r.post('/refresh', refresh)
  r.post('/logout', requireAuthMw, logout)
  return r
}
