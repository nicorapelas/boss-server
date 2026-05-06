import type { NextFunction, Request, Response } from 'express'
import type { IRole } from '../models/Role.js'
import { Role } from '../models/Role.js'
import { hashPassword, User } from '../models/User.js'

type PopulatedUser = {
  _id: unknown
  email: string
  displayName?: string
  badgeCode?: string
  active?: boolean
  allowOfflineLogin?: boolean
  legacy?: unknown
  createdAt?: Date
  updatedAt?: Date
  roleId: IRole | string
}

function serializeUser(u: PopulatedUser) {
  const r = u.roleId as IRole
  if (!r || typeof r !== 'object' || !('slug' in r)) {
    return {
      _id: u._id,
      email: u.email,
      displayName: u.displayName,
      badgeCode: u.badgeCode,
      active: u.active,
      allowOfflineLogin: u.allowOfflineLogin,
      legacy: u.legacy,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      roleId: u.roleId,
      role: 'unknown',
      roleName: '',
      rolePermissions: [] as string[],
      roleIsSystem: false,
    }
  }
  return {
    _id: u._id,
    email: u.email,
    displayName: u.displayName,
    badgeCode: u.badgeCode,
    active: u.active,
    allowOfflineLogin: u.allowOfflineLogin,
    legacy: u.legacy,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    roleId: r._id,
    role: r.slug,
    roleName: r.name,
    rolePermissions: r.permissions,
    roleIsSystem: r.isSystem,
  }
}

export async function listUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await User.find()
      .sort({ createdAt: 1 })
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    res.json(users.map((u) => serializeUser(u as PopulatedUser)))
  } catch (err) {
    next(err)
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, roleId, displayName, badgeCode, active, allowOfflineLogin } = req.body as {
      email?: string
      password?: string
      roleId?: string
      displayName?: string
      badgeCode?: string
      active?: boolean
      allowOfflineLogin?: boolean
    }

    if (!email || !password) {
      res.status(400).json({ message: 'email and password required' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters' })
      return
    }

    let resolvedRoleId = roleId
    if (!resolvedRoleId) {
      const cashier = await Role.findOne({ slug: 'cashier' })
      if (!cashier) {
        res.status(500).json({ message: 'Default role missing — restart server to seed roles' })
        return
      }
      resolvedRoleId = String(cashier._id)
    }

    const role = await Role.findById(resolvedRoleId)
    if (!role) {
      res.status(400).json({ message: 'Invalid roleId' })
      return
    }

    const passwordHash = await hashPassword(password)
    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      roleId: role._id,
      displayName: displayName?.trim() || undefined,
      badgeCode: badgeCode?.trim() || undefined,
      active: active ?? true,
      allowOfflineLogin: allowOfflineLogin ?? false,
    })

    const safeUser = await User.findById(user._id)
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    if (!safeUser) {
      res.status(500).json({ message: 'User create failed' })
      return
    }
    res.status(201).json(serializeUser(safeUser as PopulatedUser))
  } catch (err) {
    next(err)
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { roleId, active, canLogin, badgeCode, email, displayName, allowOfflineLogin } = req.body as {
      roleId?: string
      active?: boolean
      canLogin?: boolean
      badgeCode?: string
      email?: string
      displayName?: string
      allowOfflineLogin?: boolean
    }

    const $set: Record<string, unknown> = {}
    const $unset: Record<string, 1> = {}
    if (roleId !== undefined) {
      const role = await Role.findById(roleId)
      if (!role) {
        res.status(400).json({ message: 'Invalid roleId' })
        return
      }
      $set.roleId = role._id
    }
    if (active !== undefined) $set.active = active
    if (allowOfflineLogin !== undefined) $set.allowOfflineLogin = allowOfflineLogin
    if (canLogin !== undefined) $set['legacy.canLogin'] = canLogin
    if (email !== undefined) $set.email = email.toLowerCase().trim()
    if (displayName !== undefined) {
      const v = displayName.trim()
      if (v) $set.displayName = v
      else $unset.displayName = 1
    }
    if (badgeCode !== undefined) {
      const v = badgeCode.trim()
      if (v) $set.badgeCode = v
      else $unset.badgeCode = 1
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      res.status(400).json({ message: 'No fields to update' })
      return
    }

    const update: Record<string, unknown> = {}
    if (Object.keys($set).length > 0) update.$set = $set
    if (Object.keys($unset).length > 0) update.$unset = $unset

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()

    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    res.json(serializeUser(user as PopulatedUser))
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
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()

    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    res.json(serializeUser(user as PopulatedUser))
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

    const adminRole = await Role.findOne({ slug: 'admin' })
    if (!adminRole) {
      res.status(500).json({ message: 'Roles not configured' })
      return
    }

    const target = await User.findById(targetId).select('roleId').lean()
    if (!target) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    if (String(target.roleId) === String(adminRole._id)) {
      const adminCount = await User.countDocuments({ roleId: adminRole._id })
      if (adminCount <= 1) {
        res.status(400).json({ message: 'Cannot delete the last administrator' })
        return
      }
    }

    await User.findByIdAndDelete(targetId)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}
