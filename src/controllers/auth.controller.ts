import type { Request, Response, NextFunction } from 'express'
import type { IRole } from '../models/Role.js'
import { User } from '../models/User.js'
import {
  AuthError,
  loginByBadge,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
} from '../services/auth.service.js'

function secrets(req: Request) {
  return {
    access: req.app.get('accessTokenSecret') as string,
    refresh: req.app.get('refreshTokenSecret') as string,
  }
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, role } = req.body as { email?: string; password?: string; role?: 'admin' | 'cashier' }
    if (!email || !password) {
      res.status(400).json({ message: 'email and password required' })
      return
    }
    const existingCount = await User.countDocuments()
    const effectiveRole: 'admin' | 'cashier' =
      existingCount === 0 ? 'admin' : role === 'admin' ? 'cashier' : (role ?? 'cashier')
    const user = await registerUser(email, password, effectiveRole)
    const r = user.roleId as unknown as IRole
    res.status(201).json({
      id: user.id,
      email: user.email,
      role: r.slug,
      permissions: r.permissions,
    })
  } catch (e) {
    next(e)
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      res.status(400).json({ message: 'email and password required' })
      return
    }
    const { access, refresh } = secrets(req)
    const result = await loginUser(email, password, access, refresh)
    res.json(result)
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function loginBadge(req: Request, res: Response, next: NextFunction) {
  try {
    const { badgeCode } = req.body as { badgeCode?: string }
    if (!badgeCode) {
      res.status(400).json({ message: 'badgeCode required' })
      return
    }
    const { access, refresh } = secrets(req)
    const result = await loginByBadge(badgeCode, access, refresh)
    res.json(result)
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body as { refreshToken?: string }
    if (!refreshToken) {
      res.status(400).json({ message: 'refreshToken required' })
      return
    }
    const { access, refresh } = secrets(req)
    const result = await refreshSession(refreshToken, access, refresh)
    res.json(result)
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    await logoutUser(req.user.id)
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
