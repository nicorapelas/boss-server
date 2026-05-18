import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  deleteProductPhoto,
  getProductPhoto,
  uploadProductPhoto,
} from '../controllers/productPhoto.controller.js'
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  lookupProduct,
  searchProducts,
  updateProduct,
} from '../controllers/products.controller.js'

const productPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)
    cb(null, ok)
  },
}).single('photo')

export function productsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/search', requireAuth, requirePermission('catalog.read'), searchProducts)
  r.get('/lookup', requireAuth, requirePermission('catalog.read'), lookupProduct)
  r.get('/', requireAuth, requirePermission('catalog.read'), listProducts)
  r.post('/', requireAuth, requirePermission('catalog.write'), createProduct)
  r.get('/:id/photo', requireAuth, requirePermission('catalog.read'), getProductPhoto)
  r.post(
    '/:id/photo',
    requireAuth,
    requirePermission('catalog.write'),
    (req, res, next) => {
      productPhotoUpload(req, res, (err) => {
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
    uploadProductPhoto,
  )
  r.delete('/:id/photo', requireAuth, requirePermission('catalog.write'), deleteProductPhoto)
  r.get('/:id', requireAuth, requirePermission('catalog.read'), getProduct)
  r.patch('/:id', requireAuth, requirePermission('catalog.write'), updateProduct)
  r.delete('/:id', requireAuth, requirePermission('catalog.write'), deleteProduct)
  return r
}
