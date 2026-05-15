import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  deleteCatalog,
  previewVectorImport,
  runVectorImport,
} from '../controllers/catalogMigration.controller.js'
import { fixNegativeStockToZero, migrationAudit } from '../controllers/migration.controller.js'

const vectorUploadDir = path.join(os.tmpdir(), 'electropos-vector-import-upload')

async function ensureVectorUploadDir(): Promise<void> {
  await fsp.mkdir(vectorUploadDir, { recursive: true }).catch(() => undefined)
}

const vectorZipUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      void ensureVectorUploadDir().then(() => cb(null, vectorUploadDir))
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
      cb(null, `${Date.now()}-${safe}`)
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.toLowerCase().endsWith('.zip')
    cb(null, ok)
  },
}).single('vectorZip')

function handleVectorZipUpload(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  vectorZipUpload(req, res, (err) => {
    if (err) {
      const msg =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'Vector backup ZIP too large (max 512 MB)'
          : 'Invalid upload — use a .zip file'
      res.status(400).json({ message: msg })
      return
    }
    next()
  })
}

export function migrationRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/audit', requireAuth, requirePermission('migration.access'), migrationAudit)
  r.post('/fix-negative-stock-zero', requireAuth, requirePermission('migration.access'), fixNegativeStockToZero)
  r.post(
    '/vector-import/preview',
    requireAuth,
    requirePermission('migration.access'),
    handleVectorZipUpload,
    previewVectorImport,
  )
  r.post(
    '/vector-import',
    requireAuth,
    requirePermission('migration.access'),
    handleVectorZipUpload,
    runVectorImport,
  )
  r.post('/catalog/delete', requireAuth, requirePermission('migration.access'), deleteCatalog)
  return r
}
