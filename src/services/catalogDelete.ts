import fsp from 'node:fs/promises'
import path from 'node:path'
import { Product } from '../models/Product.js'
import { StoreSettings } from '../models/StoreSettings.js'
import { SupplierOffer } from '../models/SupplierOffer.js'
import { getProductPhotosDir } from '../utils/productPhotoPaths.js'
import { EMPTY_PRODUCT_PRESETS } from '../utils/productPresets.js'
import { ensureStoreSettingsDoc } from '../controllers/storeSettings.controller.js'

export type CatalogDeleteResult = {
  productsDeleted: number
  supplierOffersDeleted: number
  photosRemoved: number
  presetEntriesCleared: number
}

async function deleteAllProductPhotos(): Promise<number> {
  const dir = getProductPhotosDir()
  let removed = 0
  try {
    const names = await fsp.readdir(dir)
    await Promise.all(
      names.map(async (n) => {
        if (!n.endsWith('.webp')) return
        await fsp.unlink(path.join(dir, n))
        removed += 1
      }),
    )
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') throw e
  }
  return removed
}

/** Remove all catalog products, offers, photos, and preset product links. */
export async function deleteEntireCatalog(): Promise<CatalogDeleteResult> {
  const offersResult = await SupplierOffer.deleteMany({})
  const products = await Product.find().select('_id').lean()
  const productsDeleted = products.length
  await Product.deleteMany({})
  const photosRemoved = await deleteAllProductPhotos()

  await ensureStoreSettingsDoc()
  const before = await StoreSettings.findById('default').select('productPresets.entries').lean()
  const presetEntriesCleared = before?.productPresets?.entries?.length ?? 0
  await StoreSettings.findByIdAndUpdate('default', {
    $set: {
      'productPresets.entries': EMPTY_PRODUCT_PRESETS.entries,
      'productPresets.categories': EMPTY_PRODUCT_PRESETS.categories,
      'productPresets.subCategoriesByCategory': EMPTY_PRODUCT_PRESETS.subCategoriesByCategory,
    },
  })

  return {
    productsDeleted,
    supplierOffersDeleted: offersResult.deletedCount ?? 0,
    photosRemoved,
    presetEntriesCleared,
  }
}
