/** Stable permission ids — referenced by Role documents and JWT payloads. */
export const PERMISSION_CATALOG: { id: string; label: string }[] = [
  { id: 'catalog.read', label: 'View products / catalog' },
  { id: 'catalog.write', label: 'Create, edit, delete products' },
  { id: 'suppliers.read', label: 'View suppliers and vendor pricing' },
  { id: 'suppliers.write', label: 'Manage suppliers and vendor offers' },
  { id: 'sales.create', label: 'Record sales (POS)' },
  { id: 'sales.read', label: 'View sales history / reports' },
  { id: 'sales.refund', label: 'Refund a sale (requires sale ID from the system)' },
  { id: 'shifts.manage', label: 'POS shift end / Z-clear operations' },
  { id: 'shifts.read', label: 'View shift history / Z reports' },
  { id: 'settings.read', label: 'View store settings' },
  { id: 'settings.write', label: 'Change store settings' },
  { id: 'presets.read', label: 'View product presets' },
  { id: 'presets.write', label: 'Edit product presets (shared layout)' },
  { id: 'financials.read', label: 'View financials summary' },
  { id: 'store_credit.access', label: 'Store credit / vouchers (Back Office)' },
  { id: 'house_accounts.access', label: 'House accounts (Back Office)' },
  { id: 'laybys.use', label: 'Lay-bys: create, pay, complete (POS)' },
  { id: 'laybys.admin', label: 'Lay-bys: list all, cancel agreements' },
  { id: 'quotes.use', label: 'Quotes (POS)' },
  { id: 'tabs.use', label: 'Open tabs (POS)' },
  { id: 'migration.access', label: 'Migration audit & tools' },
  { id: 'data_cleanup.access', label: 'Data cleanup tools' },
  { id: 'users.manage', label: 'Manage users and roles' },
  { id: 'register.manager', label: 'POS manager: settings link, overrides, lay-by admin actions' },
  { id: 'register.price_override', label: 'Charge above catalog/list price (sales, lay-bys, quotes)' },
]

export const ALL_KNOWN_PERMISSION_IDS = PERMISSION_CATALOG.map((p) => p.id)

/** Default non-manager till user — matches prior cashier API access. */
export const CASHIER_PERMISSION_IDS: string[] = [
  'catalog.read',
  'sales.create',
  'sales.refund',
  'shifts.manage',
  'settings.read',
  'presets.read',
  'presets.write',
  'laybys.use',
  'quotes.use',
  'tabs.use',
]

/** Preset supervisor: cashier capabilities plus sales history, POS overrides, and lay-by admin. */
export const MANAGER_PERMISSION_IDS: string[] = [
  ...CASHIER_PERMISSION_IDS,
  'sales.read',
  'shifts.read',
  'register.manager',
  'register.price_override',
  'laybys.admin',
  'suppliers.read',
  'suppliers.write',
]

/** Superuser token marker (small JWT). */
export const PERMISSION_WILDCARD = '*'

export function normalizePermissionList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const x of raw) {
    if (typeof x === 'string' && x.trim()) out.add(x.trim())
  }
  return [...out]
}

export function hasPermission(permissions: string[], roleSlug: string, required: string): boolean {
  if (roleSlug === 'admin') return true
  if (permissions.includes(PERMISSION_WILDCARD)) return true
  return permissions.includes(required)
}

export function hasEveryPermission(
  permissions: string[],
  roleSlug: string,
  required: string[],
): boolean {
  return required.every((p) => hasPermission(permissions, roleSlug, p))
}

/** At least one permission (or admin / wildcard). */
export function hasAnyPermission(
  permissions: string[],
  roleSlug: string,
  required: string[],
): boolean {
  if (roleSlug === 'admin') return true
  if (permissions.includes(PERMISSION_WILDCARD)) return true
  return required.some((p) => permissions.includes(p))
}
