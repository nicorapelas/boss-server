import type { NextFunction, Request, Response } from 'express'
import fs from 'node:fs'
import { Types } from 'mongoose'
import { User } from '../models/User.js'
import type { IUserStaffDocument } from '../models/User.js'
import {
  deleteUserDocumentFiles,
  ensureUserDocumentsDir,
  extFromOriginalName,
  findUserDocumentFile,
  userDocumentFilePath,
  type UserDocumentKind,
} from '../utils/userDocumentPaths.js'

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

function isOid(id: string): boolean {
  return Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id
}

function parseKind(raw: string): UserDocumentKind | null {
  if (raw === 'contract' || raw === 'id') return raw
  return null
}

function serializeDocumentMeta(doc: IUserStaffDocument | null | undefined) {
  if (!doc?.originalName || !doc.uploadedAt) return null
  return {
    originalName: doc.originalName,
    mimeType: doc.mimeType ?? undefined,
    uploadedAt: doc.uploadedAt instanceof Date ? doc.uploadedAt.toISOString() : String(doc.uploadedAt),
  }
}

export async function getUserDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    const kind = parseKind(req.params.kind)
    if (!isOid(id) || !kind) {
      res.status(400).json({ message: 'Invalid user or document type' })
      return
    }
    const filePath = await findUserDocumentFile(id, kind)
    if (!filePath) {
      res.status(404).json({ message: 'Document not found' })
      return
    }
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    const user = await User.findById(id).select(`hrProfile.${kind}Document`).lean()
    const meta =
      kind === 'contract' ? user?.hrProfile?.contractDocument : user?.hrProfile?.idDocument
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'private, max-age=300')
    if (meta?.originalName) {
      res.setHeader('Content-Disposition', `inline; filename="${meta.originalName.replace(/"/g, '')}"`)
    }
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end()
    })
    stream.pipe(res)
  } catch (e) {
    next(e)
  }
}

export async function uploadUserDocument(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const id = req.params.id
    const kind = parseKind(req.params.kind)
    if (!isOid(id) || !kind) {
      res.status(400).json({ message: 'Invalid user or document type' })
      return
    }
    const file = req.file
    if (!file?.buffer?.length) {
      res.status(400).json({ message: 'file required (field name: file)' })
      return
    }
    const exists = await User.exists({ _id: id })
    if (!exists) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    const ext = extFromOriginalName(file.originalname || 'document.pdf')
    await deleteUserDocumentFiles(id, kind)
    await ensureUserDocumentsDir(id)
    const fsp = await import('node:fs/promises')
    const dest = userDocumentFilePath(id, kind, ext)
    await fsp.writeFile(dest, file.buffer)
    const meta: IUserStaffDocument = {
      originalName: file.originalname || `${kind}${ext}`,
      mimeType: file.mimetype || MIME_BY_EXT[ext],
      uploadedAt: new Date(),
      uploadedBy: new Types.ObjectId(req.user.id),
    }
    const field = kind === 'contract' ? 'hrProfile.contractDocument' : 'hrProfile.idDocument'
    await User.updateOne({ _id: id }, { $set: { [field]: meta } })
    const updated = await User.findById(id).select('hrProfile').lean()
    res.status(201).json({
      kind,
      document: serializeDocumentMeta(
        kind === 'contract' ? updated?.hrProfile?.contractDocument : updated?.hrProfile?.idDocument,
      ),
    })
  } catch (e) {
    if (e instanceof Error && e.message.includes('Unsupported')) {
      res.status(400).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function deleteUserDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    const kind = parseKind(req.params.kind)
    if (!isOid(id) || !kind) {
      res.status(400).json({ message: 'Invalid user or document type' })
      return
    }
    await deleteUserDocumentFiles(id, kind)
    const field = kind === 'contract' ? 'hrProfile.contractDocument' : 'hrProfile.idDocument'
    await User.updateOne({ _id: id }, { $unset: { [field]: 1 } })
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
