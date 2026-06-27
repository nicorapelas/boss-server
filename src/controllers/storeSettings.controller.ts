import type { NextFunction, Request, Response } from 'express'
import { StoreSettings, type IStoreSettings } from '../models/StoreSettings.js'
import { DEFAULT_STORE_NAME } from '../brand.js'
import { customerDisplayFromBody, mergeCustomerDisplay } from '../utils/customerDisplaySettings.js'
import { bumpCatalogRevision } from '../services/catalogRevision.js'
import { mergeDefaultProductPresets } from '../utils/productPresets.js'
import { DEFAULT_LOYALTY_PROGRAM, loyaltyProgramFromSettings } from '../utils/loyaltyProgram.js'
import { posLoginMethodFromSettings, type PosLoginMethod } from '../utils/posLoginMethod.js'
import {
  isPosFaceLoginConsentValid,
  POS_FACE_LOGIN_CONSENT_VERSION,
} from '../utils/faceConsent.js'
import type { IPosFaceLoginConsent } from '../models/StoreSettings.js'
import {
  attendanceFromSettings,
  DEFAULT_STAFF_ATTENDANCE,
  parseAutoClockOutTime,
  DEFAULT_AUTO_CLOCK_OUT_TIME,
} from '../utils/attendanceSettings.js'
import {
  cashRoundingFromBody,
  cashRoundingFromSettings,
  DEFAULT_CASH_ROUNDING,
} from '../utils/cashRounding.js'
import { deleteStoreIdleImageFile } from '../utils/storeIdleImagePaths.js'

export const DEFAULT_STORE_SETTINGS_DOC = {
  _id: 'default' as const,
  storeName: DEFAULT_STORE_NAME,
  storeAddressLines: [] as string[],
  storePhone: '',
  storeVatNumber: '',
  layByTerms: '',
  defaultDepositPercent: 30,
  defaultExpiryMonths: 3,
  vatRate: 0.14,
  nextLayBySeq: 1,
  nextQuoteSeq: 0,
  nextHouseAccountSeq: 0,
  nextJobCardSeq: 0,
  productPresets: {
    entries: [] as { productId: string; category: string; subCategory: string; label: string }[],
    categories: [] as string[],
    subCategoriesByCategory: {} as Record<string, string[]>,
  },
  customerDisplay: {
    enabled: true,
    idle: { headline: 'Welcome', subtext: '', imageUrl: '', idleImageRevision: 0 },
    theme: { backgroundColor: '#0f1419', accentColor: '#3b82f6' },
    footerText: 'All prices include VAT',
  },
  loyaltyProgram: DEFAULT_LOYALTY_PROGRAM,
  posLoginMethod: 'badge' as const,
  staffAttendance: DEFAULT_STAFF_ATTENDANCE,
  cashRounding: DEFAULT_CASH_ROUNDING,
  catalogRevision: 0,
  catalogPushedAt: null as string | null,
}

function serializePosFaceLoginConsent(
  raw: IPosFaceLoginConsent | null | undefined,
) {
  if (!raw?.version || !raw.acceptedAt) return null
  return {
    version: raw.version,
    acceptedAt:
      raw.acceptedAt instanceof Date ? raw.acceptedAt.toISOString() : String(raw.acceptedAt),
    acceptedBy: raw.acceptedBy ? String(raw.acceptedBy) : undefined,
  }
}

function withMergedSettings(doc: {
  productPresets?: Parameters<typeof mergeDefaultProductPresets>[0]
  customerDisplay?: unknown
  posFaceLoginConsent?: IPosFaceLoginConsent | null
  [key: string]: unknown
}) {
  return {
    ...doc,
    productPresets: mergeDefaultProductPresets(doc.productPresets),
    customerDisplay: mergeCustomerDisplay(doc.customerDisplay),
    loyaltyProgram: loyaltyProgramFromSettings(doc as unknown as IStoreSettings),
    posLoginMethod: posLoginMethodFromSettings(doc as unknown as IStoreSettings),
    posFaceLoginConsent: serializePosFaceLoginConsent(
      doc.posFaceLoginConsent as IPosFaceLoginConsent | null | undefined,
    ),
    staffAttendance: attendanceFromSettings(doc as unknown as IStoreSettings),
    cashRounding: cashRoundingFromSettings(doc as unknown as IStoreSettings),
  }
}

/** Public till boot — no auth (login screen before session). */
export async function getPosLoginConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ensureStoreSettingsDoc()
    if (!doc) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json({
      posLoginMethod: posLoginMethodFromSettings(doc as unknown as IStoreSettings),
      storeName: typeof doc.storeName === 'string' ? doc.storeName : '',
      staffAttendance: attendanceFromSettings(doc as unknown as IStoreSettings),
    })
  } catch (e) {
    next(e)
  }
}

export async function ensureStoreSettingsDoc() {
  let doc = await StoreSettings.findById('default').lean()
  if (!doc) {
    await StoreSettings.create(DEFAULT_STORE_SETTINGS_DOC)
    doc = await StoreSettings.findById('default').lean()
  }
  return doc
}

export async function getStoreSettings(_req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ensureStoreSettingsDoc()
    if (!doc) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json(withMergedSettings(doc))
  } catch (e) {
    next(e)
  }
}

export async function getCatalogSync(_req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await ensureStoreSettingsDoc()
    if (!doc) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json({
      catalogRevision: typeof doc.catalogRevision === 'number' ? doc.catalogRevision : 0,
      catalogPushedAt: doc.catalogPushedAt ?? null,
    })
  } catch (e) {
    next(e)
  }
}

export async function pushCatalogToTills(_req: Request, res: Response, next: NextFunction) {
  try {
    const catalogRevision = await bumpCatalogRevision()
    const doc = await ensureStoreSettingsDoc()
    res.json({
      catalogRevision,
      catalogPushedAt: doc?.catalogPushedAt ?? new Date().toISOString(),
    })
  } catch (e) {
    next(e)
  }
}

export async function updateStoreSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as Partial<{
      storeName: string
      storeAddressLines: string[]
      storePhone: string
      storeVatNumber: string
      layByTerms: string
      defaultDepositPercent: number
      defaultExpiryMonths: number
      vatRate: number
      customerDisplay: unknown
      loyaltyProgram: unknown
      posLoginMethod: unknown
      posFaceLoginConsent: unknown
      staffAttendance: unknown
      cashRounding: unknown
    }>
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const existing = await ensureStoreSettingsDoc()
    const set: Record<string, unknown> = {}
    if (body.storeName !== undefined) set.storeName = String(body.storeName).trim()
    if (body.storeAddressLines !== undefined) set.storeAddressLines = body.storeAddressLines
    if (body.storePhone !== undefined) set.storePhone = String(body.storePhone).trim()
    if (body.storeVatNumber !== undefined) set.storeVatNumber = String(body.storeVatNumber).trim()
    if (body.layByTerms !== undefined) set.layByTerms = String(body.layByTerms)
    if (body.defaultDepositPercent !== undefined) {
      const n = Number(body.defaultDepositPercent)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        res.status(400).json({ message: 'defaultDepositPercent must be 0–100' })
        return
      }
      set.defaultDepositPercent = n
    }
    if (body.defaultExpiryMonths !== undefined) {
      const n = Number(body.defaultExpiryMonths)
      if (!Number.isFinite(n) || n < 1 || n > 120) {
        res.status(400).json({ message: 'defaultExpiryMonths must be 1–120' })
        return
      }
      set.defaultExpiryMonths = n
    }
    if (body.vatRate !== undefined) {
      const n = Number(body.vatRate)
      if (!Number.isFinite(n) || n < 0 || n > 0.5) {
        res.status(400).json({ message: 'vatRate must be between 0 and 0.5' })
        return
      }
      set.vatRate = n
    }
    const cd = customerDisplayFromBody(body.customerDisplay)
    if (cd) {
      const existingCd = mergeCustomerDisplay(existing?.customerDisplay)
      const existingRev = existingCd.idle.idleImageRevision ?? 0
      const nextUrl = cd.idle.imageUrl.trim()
      if (nextUrl && nextUrl !== existingCd.idle.imageUrl.trim()) {
        if (existingRev > 0) {
          await deleteStoreIdleImageFile()
        }
        cd.idle.idleImageRevision = 0
      } else if (existingRev > 0) {
        cd.idle.idleImageRevision = existingRev
        cd.idle.imageUrl = ''
      }
      set.customerDisplay = cd
    }
    if (body.loyaltyProgram !== undefined && body.loyaltyProgram && typeof body.loyaltyProgram === 'object') {
      const o = body.loyaltyProgram as Record<string, unknown>
      set.loyaltyProgram = loyaltyProgramFromSettings({
        loyaltyProgram: {
          enabled: o.enabled === true,
          pointsPerRand: Number(o.pointsPerRand),
          redeemValuePerPoint: Number(o.redeemValuePerPoint),
          minRedeemPoints: Number(o.minRedeemPoints),
          maxRedeemPercent: Number(o.maxRedeemPercent),
        },
      })
    }
    let nextConsent: IPosFaceLoginConsent | null | undefined =
      (existing?.posFaceLoginConsent as IPosFaceLoginConsent | null | undefined) ?? null

    if (body.posFaceLoginConsent !== undefined && body.posFaceLoginConsent !== null) {
      const c = body.posFaceLoginConsent as Record<string, unknown>
      if (c.accepted !== true) {
        res.status(400).json({ message: 'posFaceLoginConsent.accepted must be true' })
        return
      }
      const version = String(c.version ?? '').trim()
      if (version !== POS_FACE_LOGIN_CONSENT_VERSION) {
        res.status(400).json({
          message: `posFaceLoginConsent.version must be ${POS_FACE_LOGIN_CONSENT_VERSION}`,
        })
        return
      }
      nextConsent = {
        version,
        acceptedAt: new Date(),
        acceptedBy: req.user.id as unknown as IPosFaceLoginConsent['acceptedBy'],
      }
      set.posFaceLoginConsent = nextConsent
    }

    if (body.posLoginMethod !== undefined) {
      const m = String(body.posLoginMethod).trim()
      if (m !== 'badge' && m !== 'face') {
        res.status(400).json({ message: 'posLoginMethod must be badge or face' })
        return
      }
      if (m === 'face' && !isPosFaceLoginConsentValid(nextConsent)) {
        res.status(400).json({
          message:
            'Face login requires store consent — accept the face login disclaimer in Back Office',
        })
        return
      }
      set.posLoginMethod = m as PosLoginMethod
    }
    if (body.staffAttendance !== undefined && body.staffAttendance && typeof body.staffAttendance === 'object') {
      const o = body.staffAttendance as Record<string, unknown>
      const current = attendanceFromSettings(existing as unknown as IStoreSettings)
      const minutes = Number(o.logoutPromptAfterMinutes)
      const autoTimeRaw = o.autoClockOutTime !== undefined ? String(o.autoClockOutTime) : current.autoClockOutTime
      const autoTime = parseAutoClockOutTime(autoTimeRaw) ?? current.autoClockOutTime
      if (o.autoClockOutTime !== undefined && !parseAutoClockOutTime(autoTimeRaw)) {
        res.status(400).json({ message: 'autoClockOutTime must be HH:mm (24-hour)' })
        return
      }
      set.staffAttendance = {
        enabled: o.enabled === false ? false : o.enabled === true ? true : current.enabled,
        logoutClockOutPromptEnabled:
          o.logoutClockOutPromptEnabled === false
            ? false
            : o.logoutClockOutPromptEnabled === true
              ? true
              : current.logoutClockOutPromptEnabled,
        logoutPromptAfterMinutes:
          o.logoutPromptAfterMinutes !== undefined
            ? Number.isFinite(minutes) && minutes >= 0
              ? Math.min(Math.floor(minutes), 24 * 60)
              : current.logoutPromptAfterMinutes
            : current.logoutPromptAfterMinutes,
        autoClockOutEnabled:
          o.autoClockOutEnabled === true
            ? true
            : o.autoClockOutEnabled === false
              ? false
              : current.autoClockOutEnabled,
        autoClockOutTime: autoTime || DEFAULT_AUTO_CLOCK_OUT_TIME,
      }
    }
    if (body.cashRounding !== undefined && body.cashRounding && typeof body.cashRounding === 'object') {
      const parsed = cashRoundingFromBody(body.cashRounding)
      if (!parsed) {
        res.status(400).json({ message: 'Invalid cashRounding settings' })
        return
      }
      set.cashRounding = parsed
    }
    const updated = await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: set },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    if (!updated) {
      res.status(500).json({ message: 'Store settings unavailable' })
      return
    }
    res.json(withMergedSettings(updated))
  } catch (e) {
    next(e)
  }
}
