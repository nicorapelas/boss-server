import type { NextFunction, Request, Response } from 'express'
import { Role } from '../models/Role.js'
import { User } from '../models/User.js'
import {
  ALL_KNOWN_PERMISSION_IDS,
  normalizePermissionList,
  PERMISSION_CATALOG,
} from '../permissions/catalog.js'

const RESERVED_ROLE_SLUGS = new Set(['admin', 'cashier', 'manager'])

function isPresetSystemEditableRole(slug: string, isSystem: boolean): boolean {
  return isSystem && (slug === 'cashier' || slug === 'manager')
}

export function listPermissionCatalog(_req: Request, res: Response) {
  res.json({ permissions: PERMISSION_CATALOG })
}

export async function listRoles(_req: Request, res: Response, next: NextFunction) {
  try {
    const roles = await Role.find().sort({ slug: 1 }).lean()
    res.json(roles)
  } catch (e) {
    next(e)
  }
}

function slugifyName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
  return s || 'role'
}

export async function createRole(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { name?: string; slug?: string; permissions?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      res.status(400).json({ message: 'name required' })
      return
    }
    let slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
    if (!slug) slug = slugifyName(name)
    if (RESERVED_ROLE_SLUGS.has(slug)) {
      res.status(400).json({ message: 'Reserved role slug' })
      return
    }
    const existing = await Role.findOne({ slug })
    if (existing) {
      res.status(409).json({ message: 'Role slug already exists' })
      return
    }
    const permissions = normalizePermissionList(body.permissions).filter((p) =>
      ALL_KNOWN_PERMISSION_IDS.includes(p),
    )
    const role = await Role.create({
      slug,
      name,
      permissions,
      isSystem: false,
    })
    res.status(201).json(role)
  } catch (e) {
    next(e)
  }
}

export async function updateRole(req: Request, res: Response, next: NextFunction) {
  try {
    const role = await Role.findById(req.params.id)
    if (!role) {
      res.status(404).json({ message: 'Role not found' })
      return
    }
    const body = req.body as { name?: string; slug?: string; permissions?: unknown }

    if (role.slug === 'admin') {
      if (body.name !== undefined) role.name = String(body.name).trim() || role.name
      await role.save()
      res.json(role)
      return
    }

    if (isPresetSystemEditableRole(role.slug, role.isSystem)) {
      if (body.name !== undefined) role.name = String(body.name).trim() || role.name
      if (body.permissions !== undefined) {
        role.permissions = normalizePermissionList(body.permissions).filter((p) =>
          ALL_KNOWN_PERMISSION_IDS.includes(p),
        )
      }
      await role.save()
      res.json(role)
      return
    }

    if (body.name !== undefined) role.name = String(body.name).trim() || role.name
    if (body.slug !== undefined) {
      const nextSlug = String(body.slug).trim().toLowerCase()
      if (RESERVED_ROLE_SLUGS.has(nextSlug)) {
        res.status(400).json({ message: 'Reserved role slug' })
        return
      }
      if (nextSlug !== role.slug) {
        const clash = await Role.findOne({ slug: nextSlug, _id: { $ne: role._id } })
        if (clash) {
          res.status(409).json({ message: 'Role slug already exists' })
          return
        }
        role.slug = nextSlug
      }
    }
    if (body.permissions !== undefined) {
      role.permissions = normalizePermissionList(body.permissions).filter((p) =>
        ALL_KNOWN_PERMISSION_IDS.includes(p),
      )
    }
    await role.save()
    res.json(role)
  } catch (e) {
    next(e)
  }
}

export async function deleteRole(req: Request, res: Response, next: NextFunction) {
  try {
    const role = await Role.findById(req.params.id)
    if (!role) {
      res.status(404).json({ message: 'Role not found' })
      return
    }
    if (role.isSystem) {
      res.status(400).json({ message: 'Cannot delete a system role' })
      return
    }
    const inUse = await User.countDocuments({ roleId: role._id })
    if (inUse > 0) {
      res.status(400).json({ message: 'Role is assigned to users; reassign them first' })
      return
    }
    await Role.findByIdAndDelete(role._id)
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
