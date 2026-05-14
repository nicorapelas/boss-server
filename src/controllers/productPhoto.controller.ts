import type { Request, Response, NextFunction } from 'express'
import fs from 'node:fs'
import { Types } from 'mongoose'
import { Product } from '../models/Product.js'
import {
  deleteProductPhotoFile,
  ensureProductPhotosDir,
  productPhotoFilePath,
} from '../utils/productPhotoPaths.js'
import { processProductPhotoUploadBuffer } from '../utils/processProductPhoto.js'

function isOid(id: string): boolean {
  return Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id
}

export async function getProductPhoto(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!isOid(id)) {
      res.status(400).json({ message: 'Invalid product id' })
      return
    }
    const p = await Product.findById(id).select('photoRevision').lean()
    const rev = p?.photoRevision ?? 0
    if (!p || rev < 1) {
      res.status(404).json({ message: 'No photo for this product' })
      return
    }
    const filePath = productPhotoFilePath(id)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: 'Photo file missing' })
      return
    }
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('ETag', `"${rev}"`)
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end()
    })
    stream.pipe(res)
  } catch (e) {
    next(e)
  }
}

export async function uploadProductPhoto(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!isOid(id)) {
      res.status(400).json({ message: 'Invalid product id' })
      return
    }
    const file = req.file
    if (!file?.buffer?.length) {
      res.status(400).json({ message: 'photo file required (field name: photo)' })
      return
    }
    const exists = await Product.exists({ _id: id })
    if (!exists) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    let webp: Buffer
    try {
      webp = await processProductPhotoUploadBuffer(file.buffer)
    } catch {
      res.status(400).json({ message: 'Could not read image (unsupported or corrupt file)' })
      return
    }
    await ensureProductPhotosDir()
    const fsp = await import('node:fs/promises')
    await fsp.writeFile(productPhotoFilePath(id), webp)
    const cur = await Product.findById(id).select('photoRevision').lean()
    const nextRev = (cur?.photoRevision ?? 0) + 1
    await Product.updateOne({ _id: id }, { $set: { photoRevision: nextRev } })
    const updated = await Product.findById(id).lean()
    if (!updated) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    const pr = updated.photoRevision ?? 0
    res.status(201).json({
      _id: String(updated._id),
      photoRevision: pr,
      hasPhoto: pr > 0,
    })
  } catch (e) {
    next(e)
  }
}

export async function deleteProductPhoto(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!isOid(id)) {
      res.status(400).json({ message: 'Invalid product id' })
      return
    }
    const p = await Product.findByIdAndUpdate(id, { $set: { photoRevision: 0 } }, { new: true }).lean()
    if (!p) {
      res.status(404).json({ message: 'Product not found' })
      return
    }
    await deleteProductPhotoFile(id)
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
