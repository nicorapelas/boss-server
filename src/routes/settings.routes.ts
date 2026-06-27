import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import { getProductPresets, putProductPresets } from '../controllers/productPresets.controller.js'
import {
  deleteStoreIdleImage,
  uploadStoreIdleImage,
} from '../controllers/storeIdleImage.controller.js'
import {
  getCatalogSync,
  getStoreSettings,
  pushCatalogToTills,
  updateStoreSettings,
} from '../controllers/storeSettings.controller.js'

const idleImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)
    cb(null, ok)
  },
}).single('image')

export function settingsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/store', requireAuth, requirePermission('settings.read'), getStoreSettings)
  r.patch('/store', requireAuth, requirePermission('settings.write'), updateStoreSettings)
  r.post(
    '/store/idle-image',
    requireAuth,
    requirePermission('settings.write'),
    (req, res, next) => {
      idleImageUpload(req, res, (err) => {
        if (err) {
          const msg =
            err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
              ? 'Image too large (max 12 MB before processing)'
              : 'Invalid upload'
          res.status(400).json({ message: msg })
          return
        }
        next()
      })
    },
    uploadStoreIdleImage,
  )
  r.delete('/store/idle-image', requireAuth, requirePermission('settings.write'), deleteStoreIdleImage)
  r.get('/catalog-sync', requireAuth, requirePermission('catalog.read'), getCatalogSync)
  r.post('/catalog-push', requireAuth, requirePermission('catalog.write'), pushCatalogToTills)
  r.get('/product-presets', requireAuth, requirePermission('presets.read'), getProductPresets)
  r.put('/product-presets', requireAuth, requirePermission('presets.write'), putProductPresets)
  return r
}
