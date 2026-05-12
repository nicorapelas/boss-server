import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { OpenTab, type OpenTabKind } from '../models/OpenTab.js'
import { StoreSettings } from '../models/StoreSettings.js'

type LineBody = {
  productId?: string
  name?: string
  quantity?: number
  unitPrice?: number
  listUnitPrice?: number
  addedByUserId?: string
  addedByDisplayName?: string
  addedAt?: string
}

function lineAttributionFromTabBody(row: LineBody): {
  addedByUserId?: Types.ObjectId
  addedByDisplayName?: string
  addedAt?: Date
} {
  let addedByUserId: Types.ObjectId | undefined
  if (typeof row.addedByUserId === 'string' && Types.ObjectId.isValid(row.addedByUserId)) {
    addedByUserId = new Types.ObjectId(row.addedByUserId)
  }
  const dn = typeof row.addedByDisplayName === 'string' ? row.addedByDisplayName.trim().slice(0, 120) : ''
  const addedByDisplayName = dn || undefined
  let addedAt: Date | undefined
  if (typeof row.addedAt === 'string' && row.addedAt.trim()) {
    const d = new Date(row.addedAt)
    if (!Number.isNaN(d.getTime())) addedAt = d
  }
  return { addedByUserId, addedByDisplayName, addedAt }
}

function normalizeLines(lines: LineBody[] | undefined) {
  if (!Array.isArray(lines)) return null
  const out: {
    productId: string
    name: string
    quantity: number
    unitPrice: number
    listUnitPrice?: number
    addedByUserId?: Types.ObjectId
    addedByDisplayName?: string
    addedAt?: Date
  }[] = []
  for (const row of lines) {
    if (!row.productId || !row.name || row.quantity == null || row.unitPrice == null) return null
    if (row.quantity < 1) return null
    if (row.unitPrice < 0) return null
    const { addedByUserId, addedByDisplayName, addedAt } = lineAttributionFromTabBody(row)
    out.push({
      productId: row.productId,
      name: String(row.name).trim(),
      quantity: row.quantity,
      unitPrice: Math.round(row.unitPrice * 100) / 100,
      listUnitPrice:
        row.listUnitPrice !== undefined
          ? Math.round(Number(row.listUnitPrice) * 100) / 100
          : undefined,
      ...(addedByUserId ? { addedByUserId } : {}),
      ...(addedByDisplayName ? { addedByDisplayName } : {}),
      ...(addedAt ? { addedAt } : {}),
    })
  }
  return out
}

function tabKindFromBody(kindRaw: unknown): OpenTabKind {
  return kindRaw === 'job_card' ? 'job_card' : 'tab'
}

function trimJobCardText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

function serializeTabListRow(t: {
  _id: unknown
  kind?: OpenTabKind
  tabNumber: string
  jobNumber?: string | null
  customerName: string
  phone?: string
  lines?: { quantity: number; unitPrice: number }[]
  updatedAt?: Date
}) {
  const doc = t as typeof t & { updatedAt?: Date }
  const kind: OpenTabKind = t.kind ?? 'tab'
  const total =
    Math.round((t.lines ?? []).reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100
  return {
    _id: String(t._id),
    kind,
    tabNumber: t.tabNumber,
    ...(kind === 'job_card' && t.jobNumber ? { jobNumber: t.jobNumber } : {}),
    customerName: t.customerName,
    phone: t.phone ?? '',
    lineCount: (t.lines ?? []).reduce((s, l) => s + l.quantity, 0),
    total,
    updatedAt: doc.updatedAt,
  }
}

export async function listOpenTabs(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const tabs = await OpenTab.find({ status: 'open' })
      .sort({ updatedAt: -1 })
      .select('kind tabNumber jobNumber customerName phone lines updatedAt')
      .lean()
    const list = tabs.map((t) => serializeTabListRow(t))
    res.json(list)
  } catch (e) {
    next(e)
  }
}

export async function getOpenTab(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const tab = await OpenTab.findOne({ _id: req.params.id, status: 'open' }).lean()
    if (!tab) {
      res.status(404).json({ message: 'Open tab not found' })
      return
    }
    const doc = tab as typeof tab & { updatedAt?: Date }
    const kind: OpenTabKind = tab.kind ?? 'tab'
    res.json({
      _id: String(tab._id),
      kind,
      tabNumber: tab.tabNumber,
      ...(kind === 'job_card' && tab.jobNumber ? { jobNumber: tab.jobNumber } : {}),
      ...(kind === 'job_card'
        ? {
            itemCheckedIn: tab.itemCheckedIn ?? '',
            jobDescription: tab.jobDescription ?? '',
            attachmentNote: tab.attachmentNote ?? '',
          }
        : {}),
      customerName: tab.customerName,
      phone: tab.phone ?? '',
      lines: (tab.lines ?? []).map((l) => ({
        productId: String(l.productId),
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        listUnitPrice: l.listUnitPrice,
        ...(l.addedByUserId ? { addedByUserId: String(l.addedByUserId) } : {}),
        ...(l.addedByDisplayName ? { addedByDisplayName: l.addedByDisplayName } : {}),
        ...(l.addedAt ? { addedAt: new Date(l.addedAt).toISOString() } : {}),
      })),
      updatedAt: doc.updatedAt,
    })
  } catch (e) {
    next(e)
  }
}

export async function createOpenTab(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const {
      tabNumber: rawNum,
      customerName: rawName,
      phone: rawPhone,
      lines: rawLines,
      kind: rawKind,
      itemCheckedIn: rawItemIn,
      jobDescription: rawJobDesc,
      attachmentNote: rawAttachNote,
    } = req.body as {
      tabNumber?: string
      customerName?: string
      phone?: string
      lines?: LineBody[]
      kind?: string
      itemCheckedIn?: string
      jobDescription?: string
      attachmentNote?: string
    }
    const kind = tabKindFromBody(rawKind)
    const customerName = rawName?.trim() ?? ''
    const phone = (rawPhone ?? '').trim()
    if (kind === 'tab' && !customerName) {
      res.status(400).json({ message: 'Name is required' })
      return
    }

    let tabNumber = ''
    let jobNumber: string | null = null

    if (kind === 'job_card') {
      const st = await StoreSettings.findOneAndUpdate(
        { _id: 'default' },
        [{ $set: { nextJobCardSeq: { $add: [{ $ifNull: ['$nextJobCardSeq', 0] }, 1] } } }],
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean()
      const seq = st!.nextJobCardSeq
      const year = new Date().getFullYear()
      jobNumber = `JC-${year}-${String(seq).padStart(5, '0')}`
      tabNumber = jobNumber
    } else {
      tabNumber = rawNum?.trim() ?? ''
      if (!tabNumber) {
        res.status(400).json({ message: 'Tab number is required' })
        return
      }
    }

    let lines: NonNullable<ReturnType<typeof normalizeLines>> = []
    if (rawLines !== undefined) {
      const normalized = normalizeLines(rawLines)
      if (normalized === null) {
        res.status(400).json({ message: 'Invalid lines' })
        return
      }
      lines = normalized
    }
    const itemCheckedIn = kind === 'job_card' ? trimJobCardText(rawItemIn) : ''
    const jobDescription = kind === 'job_card' ? trimJobCardText(rawJobDesc) : ''
    const attachmentNote = kind === 'job_card' ? trimJobCardText(rawAttachNote) : ''

    try {
      const tab = await OpenTab.create({
        kind,
        tabNumber,
        jobNumber: kind === 'job_card' ? jobNumber : null,
        itemCheckedIn,
        jobDescription,
        attachmentNote,
        customerName,
        phone,
        lines,
        status: 'open',
        openedBy: req.user.id,
      })
      res.status(201).json({
        _id: String(tab._id),
        kind: tab.kind ?? 'tab',
        tabNumber: tab.tabNumber,
        ...(tab.kind === 'job_card' && tab.jobNumber ? { jobNumber: tab.jobNumber } : {}),
        ...(tab.kind === 'job_card'
          ? {
              itemCheckedIn: tab.itemCheckedIn ?? '',
              jobDescription: tab.jobDescription ?? '',
              attachmentNote: tab.attachmentNote ?? '',
            }
          : {}),
        customerName: tab.customerName,
        phone: tab.phone,
        lines: tab.lines,
      })
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000) {
        res.status(409).json({
          message:
            kind === 'job_card'
              ? 'Could not assign job number — please retry'
              : 'An open tab already uses this tab number',
        })
        return
      }
      throw e
    }
  } catch (e) {
    next(e)
  }
}

export async function updateOpenTabLines(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const body = req.body as {
      lines?: LineBody[]
      itemCheckedIn?: string
      jobDescription?: string
      attachmentNote?: string
    }
    const normalized = normalizeLines(body.lines)
    if (normalized === null) {
      res.status(400).json({ message: 'lines array required' })
      return
    }
    const existing = await OpenTab.findOne({ _id: req.params.id, status: 'open' }).select('kind').lean()
    const setDoc: Record<string, unknown> = { lines: normalized }
    if (existing?.kind === 'job_card') {
      if (body.itemCheckedIn !== undefined) setDoc.itemCheckedIn = trimJobCardText(body.itemCheckedIn)
      if (body.jobDescription !== undefined) setDoc.jobDescription = trimJobCardText(body.jobDescription)
      if (body.attachmentNote !== undefined) setDoc.attachmentNote = trimJobCardText(body.attachmentNote)
    }
    const tab = await OpenTab.findOneAndUpdate(
      { _id: req.params.id, status: 'open' },
      { $set: setDoc },
      { new: true },
    ).lean()
    if (!tab) {
      res.status(404).json({ message: 'Open tab not found' })
      return
    }
    const kind: OpenTabKind = tab.kind ?? 'tab'
    res.json({
      _id: String(tab._id),
      kind,
      tabNumber: tab.tabNumber,
      ...(kind === 'job_card' && tab.jobNumber ? { jobNumber: tab.jobNumber } : {}),
      ...(kind === 'job_card'
        ? {
            itemCheckedIn: tab.itemCheckedIn ?? '',
            jobDescription: tab.jobDescription ?? '',
            attachmentNote: tab.attachmentNote ?? '',
          }
        : {}),
      customerName: tab.customerName,
      phone: tab.phone ?? '',
      lines: (tab.lines ?? []).map((l) => ({
        productId: String(l.productId),
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        listUnitPrice: l.listUnitPrice,
        ...(l.addedByUserId ? { addedByUserId: String(l.addedByUserId) } : {}),
        ...(l.addedByDisplayName ? { addedByDisplayName: l.addedByDisplayName } : {}),
        ...(l.addedAt ? { addedAt: new Date(l.addedAt).toISOString() } : {}),
      })),
    })
  } catch (e) {
    next(e)
  }
}

export async function voidOpenTab(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const tab = await OpenTab.findOneAndDelete({ _id: req.params.id, status: 'open' }).lean()
    if (!tab) {
      res.status(404).json({ message: 'Open tab not found' })
      return
    }
    res.status(204).end()
  } catch (e) {
    next(e)
  }
}
