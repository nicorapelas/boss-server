import fs from 'node:fs/promises'
import path from 'node:path'

/** Letterbox pad matches POS dark surfaces (#141414). */
export const PRODUCT_PHOTO_PAD = '#141414'

export function getProductPhotosDir(): string {
  const fromEnv = process.env.PRODUCT_PHOTOS_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd(), 'data', 'product-photos')
}

export function productPhotoFilePath(productId: string): string {
  return path.join(getProductPhotosDir(), `${productId}.webp`)
}

export async function ensureProductPhotosDir(): Promise<void> {
  await fs.mkdir(getProductPhotosDir(), { recursive: true })
}

export async function deleteProductPhotoFile(productId: string): Promise<void> {
  try {
    await fs.unlink(productPhotoFilePath(productId))
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') throw e
  }
}
