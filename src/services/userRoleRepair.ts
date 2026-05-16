import { ensureRolesAndMigrateUsers } from '../bootstrap/ensureRoles.js'
import { Role } from '../models/Role.js'
import { User } from '../models/User.js'
import { coerceObjectId } from '../utils/objectId.js'

export type UserRoleRepairResult = { fixed: number; unresolved: number }

/** Fix user.roleId links after a broken restore (no Back Office login required). */
export async function repairUserRoleLinks(
  slugHints: Map<string, string> = new Map(),
): Promise<UserRoleRepairResult> {
  await ensureRolesAndMigrateUsers()

  const roles = await Role.find().lean()
  const roleIdSet = new Set(roles.map((r) => String(r._id)))
  const roleBySlug = new Map(roles.map((r) => [r.slug, r._id]))

  let fixed = 0
  let unresolved = 0

  const users = await User.find().select('roleId email').lean()
  const singleUserStore = users.length === 1
  for (const u of users) {
    const userId = String(u._id)
    let roleId = coerceObjectId(u.roleId)
    if (roleId && roleIdSet.has(String(roleId))) continue

    if (!roleId && u.roleId && typeof u.roleId === 'object' && 'slug' in (u.roleId as object)) {
      roleId = coerceObjectId((u.roleId as { _id?: unknown })._id)
    }
    if (roleId && roleIdSet.has(String(roleId))) {
      await User.updateOne({ _id: u._id }, { $set: { roleId } })
      fixed += 1
      continue
    }

    let slugHint = slugHints.get(userId)
    if (!slugHint) {
      const raw = (await User.collection.findOne(
        { _id: u._id },
        { projection: { role: 1 } },
      )) as { role?: string } | null
      if (raw?.role) slugHint = String(raw.role).toLowerCase()
    }
    if (!slugHint && u.roleId && typeof u.roleId === 'object' && 'slug' in (u.roleId as object)) {
      slugHint = String((u.roleId as { slug?: string }).slug ?? '').toLowerCase() || undefined
    }
    if (!slugHint && singleUserStore) slugHint = 'admin'

    const fallbackSlug =
      slugHint === 'admin' ? 'admin' : slugHint === 'manager' ? 'manager' : 'cashier'
    const fallback =
      (slugHint ? roleBySlug.get(slugHint) : undefined) ??
      roleBySlug.get(fallbackSlug) ??
      roleBySlug.get('admin') ??
      roles[0]?._id

    if (!fallback) {
      unresolved += 1
      continue
    }

    await User.updateOne({ _id: u._id }, { $set: { roleId: fallback } })
    fixed += 1
  }

  return { fixed, unresolved }
}

export function normalizeRestoredUserRoleId(
  doc: Record<string, unknown>,
  slugHints: Map<string, string>,
): Record<string, unknown> {
  const out = { ...doc }
  const embedded = doc.roleId
  let roleId = coerceObjectId(embedded)
  let slugHint: string | undefined

  if (!roleId && embedded && typeof embedded === 'object') {
    const emb = embedded as { slug?: unknown; _id?: unknown }
    if (typeof emb.slug === 'string') slugHint = emb.slug.toLowerCase()
    roleId = coerceObjectId(emb._id)
  }

  const userId = coerceObjectId(doc._id)
  if (slugHint && userId) slugHints.set(String(userId), slugHint)

  if (roleId) out.roleId = roleId
  else delete out.roleId
  return out
}
