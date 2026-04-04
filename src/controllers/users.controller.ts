import type { NextFunction, Request, Response } from 'express'
import { hashPassword, User, type Role } from '../models/User.js'

export async function listUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await User.find()
      .sort({ createdAt: 1 })
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    res.json(users)
  } catch (err) {
    next(err)
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, role, displayName, badgeCode, active } = req.body as {
      email?: string
      password?: string
      role?: Role
      displayName?: string
      badgeCode?: string
      active?: boolean
    }

    if (!email || !password) {
      res.status(400).json({ message: 'email and password required' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters' })
      return
    }

    const passwordHash = await hashPassword(password)
    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role ?? 'cashier',
      displayName: displayName?.trim() || undefined,
      badgeCode: badgeCode?.trim() || undefined,
      active: active ?? true,
      // Do not set legacy here: migrated Vector users have unique (legacy.source, legacy.userNo).
      // Marking every manual user as source: 'vector' without userNo causes duplicate key errors.
    })

    const safeUser = await User.findById(user._id)
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    res.status(201).json(safeUser)
  } catch (err) {
    next(err)
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { role, active, canLogin, badgeCode, email, displayName } = req.body as {
      role?: Role
      active?: boolean
      canLogin?: boolean
      badgeCode?: string
      email?: string
      displayName?: string
    }

    const $set: Record<string, unknown> = {}
    if (role !== undefined) $set.role = role
    if (active !== undefined) $set.active = active
    if (canLogin !== undefined) $set['legacy.canLogin'] = canLogin
    if (email !== undefined) $set.email = email.toLowerCase().trim()
    if (displayName !== undefined) $set.displayName = displayName.trim() || null
    if (badgeCode !== undefined) {
      $set.badgeCode = badgeCode.trim() || null
    }

    if (Object.keys($set).length === 0) {
      res.status(400).json({ message: 'No fields to update' })
      return
    }

    const user = await User.findByIdAndUpdate(req.params.id, { $set }, { new: true })
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()

    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    res.json(user)
  } catch (err) {
    next(err)
  }
}

export async function setUserPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { password } = req.body as { password?: string }
    if (!password || password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters' })
      return
    }

    const passwordHash = await hashPassword(password)
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          passwordHash,
          active: true,
          'legacy.canLogin': true,
        },
      },
      { new: true },
    )
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()

    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    res.json(user)
  } catch (err) {
    next(err)
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const targetId = req.params.id
    if (!targetId) {
      res.status(400).json({ message: 'User id required' })
      return
    }
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    if (req.user.id === targetId) {
      res.status(400).json({ message: 'You cannot delete your own account' })
      return
    }

    const target = await User.findById(targetId).select('role').lean()
    if (!target) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    if (target.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' })
      if (adminCount <= 1) {
        res.status(400).json({ message: 'Cannot delete the last admin account' })
        return
      }
    }

    await User.findByIdAndDelete(targetId)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

