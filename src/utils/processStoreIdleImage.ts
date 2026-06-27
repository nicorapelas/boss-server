import sharp from 'sharp'

const MAX_WIDTH = 1920
const MAX_HEIGHT = 1080
const WEBP_QUALITY = 85

/** Customer-display idle banner — preserve aspect ratio, fit inside 1920×1080. */
export async function processStoreIdleImageBuffer(input: Buffer): Promise<Buffer> {
  return sharp(input, {
    failOn: 'truncated',
    limitInputPixels: 32_000_000,
    sequentialRead: true,
  })
    .rotate()
    .resize(MAX_WIDTH, MAX_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer()
}
