import type { Request, Response, NextFunction } from 'express'
import fsp from 'node:fs/promises'
import {
  previewStoreBackupZip,
  restoreStoreBackupFromZip,
  streamBackupToResponse,
} from '../services/storeBackup.js'

export async function downloadStoreBackup(req: Request, res: Response, next: NextFunction) {
  try {
    const includePhotos = req.query.includePhotos !== 'false'
    await streamBackupToResponse(res, includePhotos)
  } catch (e) {
    next(e)
  }
}

export async function previewStoreRestore(req: Request, res: Response, next: NextFunction) {
  try {
    const file = req.file
    if (!file?.path) {
      res.status(400).json({ message: 'Upload a .zip backup file' })
      return
    }
    const manifest = await previewStoreBackupZip(file.path)
    res.json({ manifest })
  } catch (e) {
    next(e)
  } finally {
    if (req.file?.path) {
      await fsp.unlink(req.file.path).catch(() => undefined)
    }
  }
}

export async function restoreStoreBackup(req: Request, res: Response, next: NextFunction) {
  try {
    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : ''
    if (confirm !== 'RESTORE') {
      res.status(400).json({ message: 'Type RESTORE in the confirm field to proceed' })
      return
    }
    const file = req.file
    if (!file?.path) {
      res.status(400).json({ message: 'Upload a .zip backup file' })
      return
    }
    const result = await restoreStoreBackupFromZip(file.path)
    res.json({
      message: 'Store backup restored. All users must sign in again.',
      manifest: result.manifest,
      inserted: result.inserted,
      roleRepair: result.roleRepair,
    })
  } catch (e) {
    next(e)
  } finally {
    if (req.file?.path) {
      await fsp.unlink(req.file.path).catch(() => undefined)
    }
  }
}
