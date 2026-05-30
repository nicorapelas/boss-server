import { StoreSettings } from '../models/StoreSettings.js'
import { publishCatalogRevision } from './realtimeHub.js'

/** Notify POS (catalog-sync poll) and Back Office that the product catalog changed. */
export async function bumpCatalogRevision(): Promise<number> {
  const catalogPushedAt = new Date().toISOString()
  const updated = await StoreSettings.findOneAndUpdate(
    { _id: 'default' },
    { $inc: { catalogRevision: 1 }, $set: { catalogPushedAt } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean()
  const rev = typeof updated?.catalogRevision === 'number' ? updated.catalogRevision : 1
  publishCatalogRevision(rev)
  return rev
}
