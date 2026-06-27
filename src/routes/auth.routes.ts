import { Router, type RequestHandler } from 'express'
import {
  getOfflineLoginPack,
  login,
  loginBadge,
  loginFace,
  logout,
  refresh,
  register,
  verifyManagerBadge,
  verifyManagerFace,
} from '../controllers/auth.controller.js'

export function authRouter(requireAuthMw: RequestHandler) {
  const r = Router()
  r.post('/register', register)
  r.post('/login', login)
  r.post('/login-badge', loginBadge)
  r.post('/login-face', loginFace)
  r.post('/refresh', refresh)
  r.get('/offline-login-pack', requireAuthMw, getOfflineLoginPack)
  r.post('/verify-manager-badge', requireAuthMw, verifyManagerBadge)
  r.post('/verify-manager-face', requireAuthMw, verifyManagerFace)
  r.post('/logout', requireAuthMw, logout)
  return r
}
