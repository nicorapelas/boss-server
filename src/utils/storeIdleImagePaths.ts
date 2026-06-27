import fs from 'node:fs/promises'
import path from 'node:path'

export function getStoreIdleImageDir(): string {
  const fromEnv = process.env.STORE_IDLE_IMAGE_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd(), 'data', 'store-assets')
}

export function storeIdleImageFilePath(): string {
  return path.join(getStoreIdleImageDir(), 'idle-image.webp')
}

export async function ensureStoreIdleImageDir(): Promise<void> {
  await fs.mkdir(getStoreIdleImageDir(), { recursive: true })
}

export async function deleteStoreIdleImageFile(): Promise<void> {
  try {
    await fs.unlink(storeIdleImageFilePath())
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') throw e
  }
}
