import type { Request, Response, NextFunction } from 'express'
import {
  getMongoCloudBackupStatus,
  runMongoCloudBackup,
} from '../services/mongoCloudBackup.service.js'

export async function getCloudBackupStatus(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(getMongoCloudBackupStatus())
  } catch (e) {
    next(e)
  }
}

export async function triggerCloudBackup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await runMongoCloudBackup('manual')
    res.json({
      message: 'MongoDB cloud backup completed.',
      result,
    })
  } catch (e) {
    next(e)
  }
}
