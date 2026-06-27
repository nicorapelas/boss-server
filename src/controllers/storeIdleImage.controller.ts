import type { NextFunction, Request, Response } from 'express'
import fs from 'node:fs'
import { ensureStoreSettingsDoc } from './storeSettings.controller.js'
import { mergeCustomerDisplay } from '../utils/customerDisplaySettings.js'
import { processStoreIdleImageBuffer } from '../utils/processStoreIdleImage.js'
import {
  deleteStoreIdleImageFile,
  ensureStoreIdleImageDir,
  storeIdleImageFilePath,
} from '../utils/storeIdleImagePaths.js'

export function storeIdleImagePublicUrl(revision: number): string {
  return `/api/settings/store/idle-image?v=${revision}`
}

export async function getStoreIdleImage(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ensureStoreSettingsDoc()
    const cd = mergeCustomerDisplay(doc?.customerDisplay)
    const rev = cd.idle.idleImageRevision ?? 0
    if (rev < 1) {
      res.status(404).json({ message: 'No idle image configured' })
      return
    }
    const filePath = storeIdleImageFilePath()
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: 'Idle image file missing' })
      return
    }
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
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

export async function uploadStoreIdleImage(req: Request, res: Response, next: NextFunction) {
  try {
    const file = req.file
    if (!file?.buffer?.length) {
      res.status(400).json({ message: 'image file required (field name: image)' })
      return
    }
    let webp: Buffer
    try {
      webp = await processStoreIdleImageBuffer(file.buffer)
    } catch {
      res.status(400).json({ message: 'Could not read image (unsupported or corrupt file)' })
      return
    }
    await ensureStoreIdleImageDir()
    const fsp = await import('node:fs/promises')
    await fsp.writeFile(storeIdleImageFilePath(), webp)

    const doc = await ensureStoreSettingsDoc()
    const cd = mergeCustomerDisplay(doc?.customerDisplay)
    const nextRev = (cd.idle.idleImageRevision ?? 0) + 1
    const { StoreSettings } = await import('../models/StoreSettings.js')
    await StoreSettings.updateOne(
      { _id: 'default' },
      {
        $set: {
          'customerDisplay.idle.idleImageRevision': nextRev,
          'customerDisplay.idle.imageUrl': '',
        },
      },
    )

    res.status(201).json({
      idleImageRevision: nextRev,
      imageUrl: storeIdleImagePublicUrl(nextRev),
    })
  } catch (e) {
    next(e)
  }
}

export async function deleteStoreIdleImage(_req: Request, res: Response, next: NextFunction) {
  try {
    await deleteStoreIdleImageFile()
    const { StoreSettings } = await import('../models/StoreSettings.js')
    await StoreSettings.updateOne(
      { _id: 'default' },
      {
        $set: {
          'customerDisplay.idle.idleImageRevision': 0,
          'customerDisplay.idle.imageUrl': '',
        },
      },
    )
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
