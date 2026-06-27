import fs from 'node:fs/promises'
import path from 'node:path'

export type UserDocumentKind = 'contract' | 'id'

const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp'])

export function getUserDocumentsDir(): string {
  const fromEnv = process.env.USER_DOCUMENTS_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd(), 'data', 'user-documents')
}

export function userDocumentDir(userId: string): string {
  return path.join(getUserDocumentsDir(), userId)
}

export function userDocumentFilePath(userId: string, kind: UserDocumentKind, ext: string): string {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  if (!ALLOWED_EXT.has(normalized)) {
    throw new Error('Unsupported file extension')
  }
  return path.join(userDocumentDir(userId), `${kind}${normalized}`)
}

export function extFromOriginalName(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) throw new Error('Unsupported file type — use PDF, JPG, PNG, or WebP')
  return ext
}

export async function ensureUserDocumentsDir(userId: string): Promise<void> {
  await fs.mkdir(userDocumentDir(userId), { recursive: true })
}

export async function deleteUserDocumentFiles(userId: string, kind: UserDocumentKind): Promise<void> {
  const dir = userDocumentDir(userId)
  for (const ext of ALLOWED_EXT) {
    try {
      await fs.unlink(path.join(dir, `${kind}${ext}`))
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') throw e
    }
  }
}

export async function findUserDocumentFile(
  userId: string,
  kind: UserDocumentKind,
): Promise<string | null> {
  const dir = userDocumentDir(userId)
  for (const ext of ALLOWED_EXT) {
    const filePath = path.join(dir, `${kind}${ext}`)
    try {
      await fs.access(filePath)
      return filePath
    } catch {
      // try next extension
    }
  }
  return null
}
