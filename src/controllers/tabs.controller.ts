import type { Request, Response, NextFunction } from 'express'
import { OpenTab } from '../models/OpenTab.js'

type LineBody = {
  productId?: string
  name?: string
  quantity?: number
  unitPrice?: number
  listUnitPrice?: number
}

function normalizeLines(lines: LineBody[] | undefined) {
  if (!Array.isArray(lines)) return null
  const out: {
    productId: string
    name: string
    quantity: number
    unitPrice: number
    listUnitPrice?: number
  }[] = []
  for (const row of lines) {
    if (!row.productId || !row.name || row.quantity == null || row.unitPrice == null) return null
    if (row.quantity < 1) return null
    if (row.unitPrice < 0) return null
    out.push({
      productId: row.productId,
      name: String(row.name).trim(),
      quantity: row.quantity,
      unitPrice: Math.round(row.unitPrice * 100) / 100,
      listUnitPrice:
        row.listUnitPrice !== undefined
          ? Math.round(Number(row.listUnitPrice) * 100) / 100
          : undefined,
    })
  }
  return out
}

export async function listOpenTabs(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const tabs = await OpenTab.find({ status: 'open' })
      .sort({ updatedAt: -1 })
      .select('tabNumber customerName phone lines updatedAt')
      .lean()
    const list = tabs.map((t) => {
      const doc = t as typeof t & { updatedAt?: Date }
      const total = Math.round(
        (t.lines ?? []).reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100,
      ) / 100
      return {
        _id: String(t._id),
        tabNumber: t.tabNumber,
        customerName: t.customerName,
        phone: t.phone ?? '',
        lineCount: (t.lines ?? []).reduce((s, l) => s + l.quantity, 0),
        total,
        updatedAt: doc.updatedAt,
      }
    })
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
    res.json({
      _id: String(tab._id),
      tabNumber: tab.tabNumber,
      customerName: tab.customerName,
      phone: tab.phone ?? '',
      lines: (tab.lines ?? []).map((l) => ({
        productId: String(l.productId),
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        listUnitPrice: l.listUnitPrice,
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
    const { tabNumber: rawNum, customerName: rawName, phone: rawPhone, lines: rawLines } =
      req.body as {
        tabNumber?: string
        customerName?: string
        phone?: string
        lines?: LineBody[]
      }
    const tabNumber = rawNum?.trim() ?? ''
    const customerName = rawName?.trim() ?? ''
    const phone = (rawPhone ?? '').trim()
    if (!tabNumber) {
      res.status(400).json({ message: 'Tab number is required' })
      return
    }
    if (!customerName) {
      res.status(400).json({ message: 'Name is required' })
      return
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
    try {
      const tab = await OpenTab.create({
        tabNumber,
        customerName,
        phone,
        lines,
        status: 'open',
        openedBy: req.user.id,
      })
      res.status(201).json({
        _id: String(tab._id),
        tabNumber: tab.tabNumber,
        customerName: tab.customerName,
        phone: tab.phone,
        lines: tab.lines,
      })
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000) {
        res.status(409).json({ message: 'An open tab already uses this tab number' })
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
    const normalized = normalizeLines((req.body as { lines?: LineBody[] }).lines)
    if (normalized === null) {
      res.status(400).json({ message: 'lines array required' })
      return
    }
    const tab = await OpenTab.findOneAndUpdate(
      { _id: req.params.id, status: 'open' },
      { $set: { lines: normalized } },
      { new: true },
    ).lean()
    if (!tab) {
      res.status(404).json({ message: 'Open tab not found' })
      return
    }
    res.json({
      _id: String(tab._id),
      tabNumber: tab.tabNumber,
      customerName: tab.customerName,
      phone: tab.phone ?? '',
      lines: (tab.lines ?? []).map((l) => ({
        productId: String(l.productId),
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        listUnitPrice: l.listUnitPrice,
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
