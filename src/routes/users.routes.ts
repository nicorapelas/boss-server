import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createUser,
  deleteUser,
  enrollUserFace,
  getUserPerformance,
  getUserSoldBySales,
  listUsers,
  removeUserFace,
  setUserPassword,
  updateUser,
} from '../controllers/users.controller.js'
import {
  deleteUserDocument,
  getUserDocument,
  uploadUserDocument,
} from '../controllers/userDocuments.controller.js'

const userDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
})

export function usersRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requirePermission('users.manage'), listUsers)
  r.post('/', requireAuth, requirePermission('users.manage'), createUser)
  r.patch('/:id', requireAuth, requirePermission('users.manage'), updateUser)
  r.post('/:id/set-password', requireAuth, requirePermission('users.manage'), setUserPassword)
  r.post('/:id/face-enrollment', requireAuth, requirePermission('users.manage'), enrollUserFace)
  r.delete('/:id/face-enrollment', requireAuth, requirePermission('users.manage'), removeUserFace)
  r.get('/:id/performance', requireAuth, requirePermission('users.manage'), getUserPerformance)
  r.get('/:id/sold-by-sales', requireAuth, requirePermission('users.manage'), getUserSoldBySales)
  r.get('/:id/documents/:kind', requireAuth, requirePermission('users.manage'), getUserDocument)
  r.post(
    '/:id/documents/:kind',
    requireAuth,
    requirePermission('users.manage'),
    (req, res, next) => {
      userDocumentUpload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const msg =
            err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
              ? 'File too large (max 12 MB)'
              : 'Invalid upload'
          res.status(400).json({ message: msg })
          return
        }
        next()
      })
    },
    uploadUserDocument,
  )
  r.delete('/:id/documents/:kind', requireAuth, requirePermission('users.manage'), deleteUserDocument)
  r.delete('/:id', requireAuth, requirePermission('users.manage'), deleteUser)
  return r
}
