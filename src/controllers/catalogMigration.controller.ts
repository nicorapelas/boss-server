import type { NextFunction, Request, Response } from 'express'
import AdmZip from 'adm-zip'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bumpCatalogRevision } from '../services/catalogRevision.js'
import { deleteEntireCatalog } from '../services/catalogDelete.js'
import {
  importVectorProductsFromDir,
  normalizeVectorProductSkus,
  resolveVectorDatDir,
} from '../services/vectorImport.js'

async function extractVectorZip(zipPath: string): Promise<string> {
  const extractDir = path.join(os.tmpdir(), 'electropos-vector-import', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await fsp.mkdir(extractDir, { recursive: true })
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(extractDir, true)
  await resolveVectorDatDir(extractDir)
  return extractDir
}

async function cleanupDir(dir: string | undefined) {
  if (!dir) return
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

export async function previewVectorImport(req: Request, res: Response, next: NextFunction) {
  let extractDir: string | undefined
  try {
    const file = req.file
    if (!file?.path) {
      res.status(400).json({ message: 'Upload a .zip of the Vector RP_BACK folder' })
      return
    }
    extractDir = await extractVectorZip(file.path)
    const importResult = await importVectorProductsFromDir(extractDir, { dryRun: true })
    res.json({ import: importResult })
  } catch (e) {
    next(e)
  } finally {
    if (req.file?.path) await fsp.unlink(req.file.path).catch(() => undefined)
    await cleanupDir(extractDir)
  }
}

export async function runVectorImport(req: Request, res: Response, next: NextFunction) {
  let extractDir: string | undefined
  try {
    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : ''
    if (confirm !== 'IMPORT') {
      res.status(400).json({ message: 'Type IMPORT in the confirm field to proceed' })
      return
    }
    const file = req.file
    if (!file?.path) {
      res.status(400).json({ message: 'Upload a .zip of the Vector RP_BACK folder' })
      return
    }
    const replaceCatalog =
      req.body?.replaceCatalog === true ||
      req.body?.replaceCatalog === 'true' ||
      req.body?.replaceCatalog === '1'
    const normalizeSku =
      req.body?.normalizeSku !== false &&
      req.body?.normalizeSku !== 'false' &&
      req.body?.normalizeSku !== '0'

    extractDir = await extractVectorZip(file.path)

    let catalogDelete: Awaited<ReturnType<typeof deleteEntireCatalog>> | undefined
    if (replaceCatalog) {
      catalogDelete = await deleteEntireCatalog()
    }

    const importResult = await importVectorProductsFromDir(extractDir, { dryRun: false })
    const skuNormalize = normalizeSku ? await normalizeVectorProductSkus() : undefined
    const catalogRevision = await bumpCatalogRevision()

    res.json({
      message: 'Vector catalog import completed.',
      catalogDelete,
      import: importResult,
      skuNormalize,
      catalogRevision,
    })
  } catch (e) {
    next(e)
  } finally {
    if (req.file?.path) await fsp.unlink(req.file.path).catch(() => undefined)
    await cleanupDir(extractDir)
  }
}

export async function deleteCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : ''
    if (confirm !== 'DELETE CATALOG') {
      res.status(400).json({ message: 'Type DELETE CATALOG in the confirm field to proceed' })
      return
    }
    const result = await deleteEntireCatalog()
    const catalogRevision = await bumpCatalogRevision()
    res.json({
      message: 'All products, supplier offers, photos, and preset links were removed.',
      ...result,
      catalogRevision,
    })
  } catch (e) {
    next(e)
  }
}
