import sharp from 'sharp'
import { PRODUCT_PHOTO_PAD } from './productPhotoPaths.js'

const OUT_SIZE = 1024
const WEBP_QUALITY = 85

/**
 * Letterboxed 1024×1024 WebP (uniform size for downstream ML), pad #141414, strip metadata.
 */
export async function processProductPhotoUploadBuffer(input: Buffer): Promise<Buffer> {
  return sharp(input, {
    failOn: 'truncated',
    limitInputPixels: 32_000_000,
    sequentialRead: true,
  })
    .rotate()
    .resize(OUT_SIZE, OUT_SIZE, {
      fit: 'contain',
      position: 'centre',
      background: PRODUCT_PHOTO_PAD,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()
}
