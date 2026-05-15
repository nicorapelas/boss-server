import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  downloadStoreBackup,
  previewStoreRestore,
  restoreStoreBackup,
} from '../controllers/storeBackup.controller.js'

const uploadDir = path.join(os.tmpdir(), 'electropos-store-restore')

async function ensureUploadDir(): Promise<void> {
  await fsp.mkdir(uploadDir, { recursive: true }).catch(() => undefined)
}

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      void ensureUploadDir().then(() => cb(null, uploadDir))
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
      cb(null, `${Date.now()}-${safe}`)
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.toLowerCase().endsWith('.zip')
    cb(null, ok)
  },
}).single('backup')

function handleRestoreUpload(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  restoreUpload(req, res, (err) => {
    if (err) {
      const msg =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Backup file too large (max 2 GB)'
          : 'Invalid upload — use a .zip file'
      res.status(400).json({ message: msg })
      return
    }
    next()
  })
}

export function storeBackupRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/backup', requireAuth, requirePermission('migration.access'), downloadStoreBackup)
  r.post(
    '/restore/preview',
    requireAuth,
    requirePermission('migration.access'),
    handleRestoreUpload,
    previewStoreRestore,
  )
  r.post(
    '/restore',
    requireAuth,
    requirePermission('migration.access'),
    handleRestoreUpload,
    restoreStoreBackup,
  )
  return r
}
