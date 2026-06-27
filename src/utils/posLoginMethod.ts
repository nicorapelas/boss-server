import type { IStoreSettings } from '../models/StoreSettings.js'

export type PosLoginMethod = 'badge' | 'face'

export const DEFAULT_POS_LOGIN_METHOD: PosLoginMethod = 'badge'

export function posLoginMethodFromSettings(
  doc: Pick<IStoreSettings, 'posLoginMethod'> | null | undefined,
): PosLoginMethod {
  const raw = doc?.posLoginMethod
  return raw === 'face' ? 'face' : 'badge'
}
