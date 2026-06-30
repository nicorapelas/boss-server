import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import {
  HOUSE_ACCOUNT_PAYMENT_TERMS,
  HouseAccount,
  HouseAccountLedger,
  type HouseAccountPaymentTerms,
} from '../models/HouseAccount.js'
import { StoreSettings } from '../models/StoreSettings.js'
import {
  buildHouseAccountStatement,
  parseHouseAccountStatementQuery,
} from '../services/houseAccountStatement.service.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimOptional(value: unknown, maxLen: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : ''
}

function parseAddressLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((line) => String(line).trim()).filter(Boolean).slice(0, 8)
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
  }
  return []
}

function parsePaymentTerms(value: unknown): HouseAccountPaymentTerms {
  const raw = typeof value === 'string' ? value.trim() : ''
  return (HOUSE_ACCOUNT_PAYMENT_TERMS as readonly string[]).includes(raw)
    ? (raw as HouseAccountPaymentTerms)
    : ''
}

type HouseAccountProfileInput = {
  contactPerson?: string
  email?: string
  vatNumber?: string
  companyRegistrationNumber?: string
  addressLines?: string[] | string
  paymentTerms?: string
  notes?: string
}

function profileFromBody(body: HouseAccountProfileInput) {
  return {
    contactPerson: trimOptional(body.contactPerson, 120),
    email: trimOptional(body.email, 160).toLowerCase(),
    vatNumber: trimOptional(body.vatNumber, 32),
    companyRegistrationNumber: trimOptional(body.companyRegistrationNumber, 32),
    addressLines: parseAddressLines(body.addressLines),
    paymentTerms: parsePaymentTerms(body.paymentTerms),
    notes: trimOptional(body.notes, 2000),
  }
}

export async function searchHouseAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const limit = Math.min(Number(req.query.limit) || 50, 500)
    const includeClosed =
      req.query.includeClosed === '1' || req.query.includeClosed === 'true'
    const filter: Record<string, unknown> = {}
    if (!includeClosed) filter.status = 'active'
    if (q.length > 0) {
      const rx = new RegExp(escapeRegex(q), 'i')
      filter.$or = [
        { accountNumber: rx },
        { name: rx },
        { phone: rx },
        { contactPerson: rx },
        { email: rx },
        { vatNumber: rx },
        { companyRegistrationNumber: rx },
      ]
    }
    const list = await HouseAccount.find(filter)
      .sort({ accountNumber: 1 })
      .limit(limit)
      .lean()
    res.json(list)
  } catch (e) {
    next(e)
  }
}

export async function getHouseAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid id' })
      return
    }
    const row = await HouseAccount.findById(id).lean()
    if (!row) {
      res.status(404).json({ message: 'Account not found' })
      return
    }
    res.json(row)
  } catch (e) {
    next(e)
  }
}

export async function createHouseAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as {
      name?: string
      phone?: string
      creditLimit?: number | null
    } & HouseAccountProfileInput
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      res.status(400).json({ message: 'name required' })
      return
    }
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    let creditLimit: number | null = null
    if (body.creditLimit !== undefined && body.creditLimit !== null) {
      const n = Number(body.creditLimit)
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ message: 'creditLimit must be >= 0 or null' })
        return
      }
      creditLimit = round2(n)
    }
    const profile = profileFromBody(body)

    const settings = await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $inc: { nextHouseAccountSeq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    const seq = settings?.nextHouseAccountSeq ?? 1
    const accountNumber = `ACC-${String(seq).padStart(5, '0')}`

    const created = await HouseAccount.create({
      accountNumber,
      name,
      phone,
      ...profile,
      balance: 0,
      creditLimit,
      status: 'active',
    })
    res.status(201).json(created)
  } catch (e) {
    next(e)
  }
}

export async function updateHouseAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid id' })
      return
    }
    const body = req.body as {
      name?: string
      phone?: string
      creditLimit?: number | null
      status?: 'active' | 'closed'
    } & HouseAccountProfileInput
    const set: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) {
        res.status(400).json({ message: 'name cannot be empty' })
        return
      }
      set.name = name
    }
    if (body.phone !== undefined) set.phone = String(body.phone).trim()
    if (body.contactPerson !== undefined) set.contactPerson = trimOptional(body.contactPerson, 120)
    if (body.email !== undefined) set.email = trimOptional(body.email, 160).toLowerCase()
    if (body.vatNumber !== undefined) set.vatNumber = trimOptional(body.vatNumber, 32)
    if (body.companyRegistrationNumber !== undefined) {
      set.companyRegistrationNumber = trimOptional(body.companyRegistrationNumber, 32)
    }
    if (body.addressLines !== undefined) set.addressLines = parseAddressLines(body.addressLines)
    if (body.paymentTerms !== undefined) set.paymentTerms = parsePaymentTerms(body.paymentTerms)
    if (body.notes !== undefined) set.notes = trimOptional(body.notes, 2000)
    if (body.creditLimit !== undefined) {
      if (body.creditLimit === null) set.creditLimit = null
      else {
        const n = Number(body.creditLimit)
        if (!Number.isFinite(n) || n < 0) {
          res.status(400).json({ message: 'creditLimit must be >= 0 or null' })
          return
        }
        set.creditLimit = round2(n)
      }
    }
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'closed') {
        res.status(400).json({ message: 'status must be active or closed' })
        return
      }
      set.status = body.status
    }
    if (Object.keys(set).length === 0) {
      res.status(400).json({ message: 'No updates' })
      return
    }
    const updated = await HouseAccount.findByIdAndUpdate(id, { $set: set }, { new: true }).lean()
    if (!updated) {
      res.status(404).json({ message: 'Account not found' })
      return
    }
    res.json(updated)
  } catch (e) {
    next(e)
  }
}

export async function recordHouseAccountPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid id' })
      return
    }
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const body = req.body as {
      amount?: number
      cashAmount?: number
      cardAmount?: number
      note?: string
    }
    const amount = round2(Math.max(0, Number(body.amount ?? 0) || 0))
    const cashAmount = round2(Math.max(0, Number(body.cashAmount ?? 0) || 0))
    const cardAmount = round2(Math.max(0, Number(body.cardAmount ?? 0) || 0))
    if (amount <= 0) {
      res.status(400).json({ message: 'amount required' })
      return
    }
    if (Math.abs(round2(cashAmount + cardAmount) - amount) > 0.02) {
      res.status(400).json({ message: 'cashAmount + cardAmount must equal amount' })
      return
    }

    const acct = await HouseAccount.findById(id)
    if (!acct || acct.status !== 'active') {
      res.status(404).json({ message: 'Account not found or closed' })
      return
    }
    if (acct.balance < amount - 0.01) {
      res.status(400).json({ message: 'Payment exceeds balance owed' })
      return
    }

    acct.balance = round2(acct.balance - amount)
    await acct.save()
    await HouseAccountLedger.create({
      houseAccountId: acct._id,
      accountNumber: acct.accountNumber,
      kind: 'payment',
      amount,
      cashAmount: cashAmount > 0 ? cashAmount : undefined,
      cardAmount: cardAmount > 0 ? cardAmount : undefined,
      note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : undefined,
      createdBy: req.user.id,
    })

    const lean = await HouseAccount.findById(id).lean()
    res.json(lean)
  } catch (e) {
    next(e)
  }
}

export async function listHouseAccountLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid id' })
      return
    }
    const limit = Math.min(Number(req.query.limit) || 100, 300)
    const list = await HouseAccountLedger.find({ houseAccountId: id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
    res.json(list)
  } catch (e) {
    next(e)
  }
}

export async function getHouseAccountStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid id' })
      return
    }
    const { from, to } = parseHouseAccountStatementQuery(req.query as Record<string, unknown>)
    const statement = await buildHouseAccountStatement(id, { from, to })
    if (!statement) {
      res.status(404).json({ message: 'Account not found' })
      return
    }
    res.json(statement)
  } catch (e) {
    next(e)
  }
}
