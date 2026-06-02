import type { NextFunction, Request, Response } from 'express'
import { LoyaltyLedger, LoyaltyMember, LoyaltyPhoneChange } from '../models/LoyaltyMember.js'
import {
  adminChangeLoyaltyPhone,
  getLoyaltyProgramConfig,
  listLoyaltyMemberPurchases,
  lookupLoyaltyMember,
  maskPhone,
} from '../services/loyalty.service.js'
import { normalizePhone } from '../utils/phone.js'

export async function getLoyaltyProgram(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getLoyaltyProgramConfig())
  } catch (e) {
    next(e)
  }
}

export async function lookupLoyalty(req: Request, res: Response, next: NextFunction) {
  try {
    const phone = normalizePhone(String(req.query.phone ?? ''))
    if (!phone) {
      res.status(400).json({ message: 'phone query required' })
      return
    }
    const result = await lookupLoyaltyMember(phone)
    if (!result) {
      const cfg = await getLoyaltyProgramConfig()
      if (!cfg.enabled) {
        res.status(400).json({ message: 'Loyalty program is disabled' })
        return
      }
      res.json({
        memberId: null,
        phoneMasked: maskPhone(phone),
        pointsBalance: 0,
        program: cfg,
        isNew: true,
      })
      return
    }
    res.json({ ...result, isNew: false })
  } catch (e) {
    next(e)
  }
}

export async function listLoyaltyMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 1000)
    const q = typeof req.query.q === 'string' ? normalizePhone(req.query.q) : ''
    const filter = q ? { phone: { $regex: q } } : {}
    const list = await LoyaltyMember.find(filter).sort({ updatedAt: -1 }).limit(limit).lean()
    res.json(
      list.map((m) => ({
        _id: String(m._id),
        phoneMasked: maskPhone(m.phone),
        pointsBalance: Math.max(0, Math.floor(Number(m.pointsBalance ?? 0))),
        status: m.status,
        optedInAt: m.optedInAt,
        createdAt: (m as { createdAt?: Date }).createdAt,
        updatedAt: (m as { updatedAt?: Date }).updatedAt,
      })),
    )
  } catch (e) {
    next(e)
  }
}

export async function getLoyaltyMember(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? '').trim()
    const member = await LoyaltyMember.findById(id).lean()
    if (!member) {
      res.status(404).json({ message: 'Member not found' })
      return
    }
    const ledger = await LoyaltyLedger.find({ memberId: member._id }).sort({ createdAt: -1 }).limit(100).lean()
    res.json({
      _id: String(member._id),
      phone: member.phone,
      phoneMasked: maskPhone(member.phone),
      pointsBalance: Math.max(0, Math.floor(Number(member.pointsBalance ?? 0))),
      status: member.status,
      ledger,
    })
  } catch (e) {
    next(e)
  }
}

export async function getLoyaltyMemberPurchases(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? '').trim()
    const limit = Number(req.query.limit)
    const skip = Number(req.query.skip)
    try {
      const result = await listLoyaltyMemberPurchases(id, {
        limit: Number.isFinite(limit) ? limit : undefined,
        skip: Number.isFinite(skip) ? skip : undefined,
      })
      res.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'MEMBER_NOT_FOUND' || msg === 'INVALID_MEMBER_ID') {
        res.status(404).json({ message: 'Member not found' })
        return
      }
      throw err
    }
  } catch (e) {
    next(e)
  }
}

export async function adjustLoyaltyPoints(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const { memberId, points, note } = req.body as { memberId?: string; points?: number; note?: string }
    const delta = Math.trunc(Number(points ?? 0))
    if (!memberId || !delta) {
      res.status(400).json({ message: 'memberId and non-zero points required' })
      return
    }
    const member = await LoyaltyMember.findById(memberId)
    if (!member) {
      res.status(404).json({ message: 'Member not found' })
      return
    }
    if (delta < 0 && member.pointsBalance + delta < 0) {
      res.status(400).json({ message: 'Adjustment would make balance negative' })
      return
    }
    member.pointsBalance = Math.max(0, member.pointsBalance + delta)
    await member.save()
    await LoyaltyLedger.create({
      memberId: member._id,
      phone: member.phone,
      points: delta,
      kind: 'adjust',
      refType: 'admin',
      note: typeof note === 'string' ? note.trim().slice(0, 500) : undefined,
      createdBy: req.user.id,
    })
    res.json({
      _id: String(member._id),
      phoneMasked: maskPhone(member.phone),
      pointsBalance: member.pointsBalance,
    })
  } catch (e) {
    next(e)
  }
}

export async function changeLoyaltyPhone(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const { fromPhone, toPhone, note } = req.body as {
      fromPhone?: string
      toPhone?: string
      note?: string
    }
    try {
      const result = await adminChangeLoyaltyPhone({
        fromPhone: String(fromPhone ?? ''),
        toPhone: String(toPhone ?? ''),
        userId: req.user.id,
        note,
      })
      res.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'INVALID_PHONE') {
        res.status(400).json({ message: 'Invalid phone number' })
        return
      }
      if (msg === 'MEMBER_NOT_FOUND') {
        res.status(404).json({ message: 'Member not found' })
        return
      }
      if (msg === 'PHONE_IN_USE') {
        res.status(409).json({ message: 'Target phone already has a loyalty account' })
        return
      }
      if (msg === 'SAME_PHONE') {
        res.status(400).json({ message: 'New phone must differ from current phone' })
        return
      }
      throw err
    }
  } catch (e) {
    next(e)
  }
}

export async function listLoyaltyPhoneChanges(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const list = await LoyaltyPhoneChange.find().sort({ createdAt: -1 }).limit(limit).lean()
    res.json(
      list.map((row) => ({
        ...row,
        _id: String(row._id),
        memberId: String(row.memberId),
        fromPhoneMasked: maskPhone(row.fromPhone),
        toPhoneMasked: maskPhone(row.toPhone),
      })),
    )
  } catch (e) {
    next(e)
  }
}
