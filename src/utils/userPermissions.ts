import { Role } from '../models/Role.js'
import { User } from '../models/User.js'
import { hasPermission } from '../permissions/catalog.js'
import { coerceObjectId } from './objectId.js'

/** Fresh role from DB when JWT permissions may be stale (e.g. after role edits without re-login). */
export async function userHasRegisterManager(
  userId: string,
  jwtPermissions: string[],
  jwtRole: string,
): Promise<boolean> {
  if (hasPermission(jwtPermissions, jwtRole, 'register.manager')) return true
  const user = await User.findById(userId).select('roleId').lean()
  if (!user?.roleId) return false
  const roleId = coerceObjectId(user.roleId)
  if (!roleId) return false
  const role = await Role.findById(roleId).select('slug permissions').lean()
  if (!role?.slug) return false
  return hasPermission(role.permissions ?? [], role.slug, 'register.manager')
}
