import { User } from '../models/User.js'
import { Role } from '../models/Role.js'
import {
  CASHIER_PERMISSION_IDS,
  MANAGER_PERMISSION_IDS,
  PERMISSION_WILDCARD,
} from '../permissions/catalog.js'

export async function ensureRolesAndMigrateUsers(): Promise<void> {
  let admin = await Role.findOne({ slug: 'admin' })
  if (!admin) {
    admin = await Role.create({
      slug: 'admin',
      name: 'Administrator',
      permissions: [PERMISSION_WILDCARD],
      isSystem: true,
    })
  }

  let cashier = await Role.findOne({ slug: 'cashier' })
  if (!cashier) {
    cashier = await Role.create({
      slug: 'cashier',
      name: 'Cashier',
      permissions: [...CASHIER_PERMISSION_IDS],
      isSystem: true,
    })
  }

  let manager = await Role.findOne({ slug: 'manager' })
  if (!manager) {
    manager = await Role.create({
      slug: 'manager',
      name: 'Manager',
      permissions: [...MANAGER_PERMISSION_IDS],
      isSystem: true,
    })
  }

  // Merge new system permissions into existing cashier/manager roles (DB may predate new ids).
  await Role.updateMany(
    { slug: { $in: ['cashier', 'manager'] } },
    { $addToSet: { permissions: { $each: ['sales.refund', 'shifts.manage'] } } },
  )
  await Role.updateOne(
    { slug: 'manager' },
    { $addToSet: { permissions: 'shifts.read' } },
  )
  await Role.updateOne(
    { slug: 'manager' },
    { $addToSet: { permissions: { $each: ['suppliers.read', 'suppliers.write'] } } },
  )
  await Role.updateOne(
    { slug: 'manager' },
    { $addToSet: { permissions: { $each: ['loyalty.access', 'loyalty.admin'] } } },
  )
  await Role.updateOne(
    { slug: 'manager' },
    { $addToSet: { permissions: 'sales.exchange' } },
  )

  const raw = User.collection
  await raw.updateMany(
    { role: 'admin', $or: [{ roleId: { $exists: false } }, { roleId: null }] },
    { $set: { roleId: admin._id } },
  )
  await raw.updateMany(
    { $or: [{ roleId: { $exists: false } }, { roleId: null }] },
    { $set: { roleId: cashier._id } },
  )

  await raw.updateMany({}, { $unset: { role: '' } })
}
