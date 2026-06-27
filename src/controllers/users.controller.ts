import type { NextFunction, Request, Response } from 'express'
import type { IRole } from '../models/Role.js'
import { Role } from '../models/Role.js'
import { Types } from 'mongoose'
import { hashPassword, User } from '../models/User.js'
import {
  averageEmbeddings,
  FACE_MODEL_ID,
  validateFaceEmbedding,
} from '../utils/faceMatch.js'
import { STAFF_FACE_ENROLLMENT_CONSENT_VERSION } from '../utils/faceConsent.js'
import type { IUserHrProfile, IUserStaffDocument, IUserStaffLoan } from '../models/User.js'
import {
  parseOptionalDate,
  parseOptionalMoney,
  parseOptionalString,
  parsePaymentTerms,
  parseStaffLoans,
} from '../utils/userHrProfile.js'
import { buildUserPerformance } from '../services/userPerformance.service.js'
import { buildUserSoldBySales } from '../services/soldBySale.service.js'

type PopulatedUser = {
  _id: unknown
  email: string
  displayName?: string
  badgeCode?: string
  active?: boolean
  allowOfflineLogin?: boolean
  allowShopAssistCatalogAdjustment?: boolean
  faceEnrollment?: {
    embedding?: number[]
    modelId?: string
    enrolledAt?: Date
    staffConsentAt?: Date
    consentVersion?: string
  } | null
  legacy?: unknown
  hrProfile?: IUserHrProfile | null
  createdAt?: Date
  updatedAt?: Date
  roleId: IRole | string
}

function serializeStaffDocument(doc: IUserStaffDocument | null | undefined) {
  if (!doc?.originalName || !doc.uploadedAt) return null
  return {
    originalName: doc.originalName,
    mimeType: doc.mimeType ?? undefined,
    uploadedAt: doc.uploadedAt instanceof Date ? doc.uploadedAt.toISOString() : String(doc.uploadedAt),
  }
}

function serializeStaffLoan(loan: IUserStaffLoan & { _id?: unknown }) {
  let startDate: string | null = null
  if (loan.startDate instanceof Date) startDate = loan.startDate.toISOString().slice(0, 10)
  return {
    _id: loan._id != null ? String(loan._id) : undefined,
    startDate,
    amount: loan.amount ?? null,
    terms: loan.terms ?? null,
    notes: loan.notes ?? null,
  }
}

function serializeHrProfile(hr: IUserHrProfile | null | undefined) {
  if (!hr) return null
  const hasLoans = Array.isArray(hr.loans) && hr.loans.length > 0
  const hasScalar =
    hr.phone ||
    hr.startDate ||
    hr.paymentTerms ||
    hr.paymentAmount != null ||
    hr.notes ||
    hr.scoreCard ||
    hr.contractDocument?.originalName ||
    hr.idDocument?.originalName ||
    hasLoans
  if (!hasScalar) return null
  return {
    phone: hr.phone ?? null,
    startDate: hr.startDate instanceof Date ? hr.startDate.toISOString().slice(0, 10) : hr.startDate ?? null,
    paymentTerms: hr.paymentTerms ?? null,
    paymentAmount: hr.paymentAmount ?? null,
    notes: hr.notes ?? null,
    scoreCard: hr.scoreCard ?? null,
    contractDocument: serializeStaffDocument(hr.contractDocument ?? undefined),
    idDocument: serializeStaffDocument(hr.idDocument ?? undefined),
    loans: hasLoans ? hr.loans!.map((l) => serializeStaffLoan(l as IUserStaffLoan & { _id?: unknown })) : [],
  }
}

function userHasFaceEnrollment(u: PopulatedUser): boolean {
  const fe = u.faceEnrollment
  if (!fe?.modelId) return false
  const emb = fe.embedding
  if (Array.isArray(emb) && emb.length >= 128) return true
  return false
}

function faceEnrollmentConsentAt(u: PopulatedUser): string | null {
  const at = u.faceEnrollment?.staffConsentAt
  if (!at) return null
  return at instanceof Date ? at.toISOString() : String(at)
}

function serializeUser(u: PopulatedUser) {
  const r = u.roleId as IRole
  if (!r || typeof r !== 'object' || !('slug' in r)) {
    return {
      _id: u._id,
      email: u.email,
      displayName: u.displayName,
      badgeCode: u.badgeCode,
      active: u.active,
      allowOfflineLogin: u.allowOfflineLogin,
      allowShopAssistCatalogAdjustment: u.allowShopAssistCatalogAdjustment,
      legacy: u.legacy,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      roleId: u.roleId,
      role: 'unknown',
      roleName: '',
      rolePermissions: [] as string[],
      roleIsSystem: false,
      hasFaceEnrollment: userHasFaceEnrollment(u),
      faceEnrollmentConsentAt: faceEnrollmentConsentAt(u),
      hrProfile: serializeHrProfile(u.hrProfile ?? undefined),
    }
  }
  return {
    _id: u._id,
    email: u.email,
    displayName: u.displayName,
    badgeCode: u.badgeCode,
    active: u.active,
    allowOfflineLogin: u.allowOfflineLogin,
    allowShopAssistCatalogAdjustment: u.allowShopAssistCatalogAdjustment,
    legacy: u.legacy,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    roleId: r._id,
    role: r.slug,
    roleName: r.name,
    rolePermissions: r.permissions,
    roleIsSystem: r.isSystem,
    hasFaceEnrollment: userHasFaceEnrollment(u),
    faceEnrollmentConsentAt: faceEnrollmentConsentAt(u),
    hrProfile: serializeHrProfile(u.hrProfile ?? undefined),
  }
}

export async function listUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await User.find()
      .sort({ createdAt: 1 })
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    res.json(users.map((u) => serializeUser(u as PopulatedUser)))
  } catch (err) {
    next(err)
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      email,
      password,
      roleId,
      displayName,
      badgeCode,
      active,
      allowOfflineLogin,
      allowShopAssistCatalogAdjustment,
    } = req.body as {
      email?: string
      password?: string
      roleId?: string
      displayName?: string
      badgeCode?: string
      active?: boolean
      allowOfflineLogin?: boolean
      allowShopAssistCatalogAdjustment?: boolean
    }

    if (!email || !password) {
      res.status(400).json({ message: 'email and password required' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters' })
      return
    }

    let resolvedRoleId = roleId
    if (!resolvedRoleId) {
      const cashier = await Role.findOne({ slug: 'cashier' })
      if (!cashier) {
        res.status(500).json({ message: 'Default role missing — restart server to seed roles' })
        return
      }
      resolvedRoleId = String(cashier._id)
    }

    const role = await Role.findById(resolvedRoleId)
    if (!role) {
      res.status(400).json({ message: 'Invalid roleId' })
      return
    }

    const passwordHash = await hashPassword(password)
    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      roleId: role._id,
      displayName: displayName?.trim() || undefined,
      badgeCode: badgeCode?.trim() || undefined,
      active: active ?? true,
      allowOfflineLogin: allowOfflineLogin ?? false,
      allowShopAssistCatalogAdjustment: allowShopAssistCatalogAdjustment ?? false,
    })

    const safeUser = await User.findById(user._id)
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    if (!safeUser) {
      res.status(500).json({ message: 'User create failed' })
      return
    }
    res.status(201).json(serializeUser(safeUser as PopulatedUser))
  } catch (err) {
    next(err)
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      roleId,
      active,
      canLogin,
      badgeCode,
      email,
      displayName,
      allowOfflineLogin,
      allowShopAssistCatalogAdjustment,
      hrProfile,
    } = req.body as {
      roleId?: string
      active?: boolean
      canLogin?: boolean
      badgeCode?: string
      email?: string
      displayName?: string
      allowOfflineLogin?: boolean
      allowShopAssistCatalogAdjustment?: boolean
      hrProfile?: Record<string, unknown> | null
    }

    const $set: Record<string, unknown> = {}
    const $unset: Record<string, 1> = {}
    if (roleId !== undefined) {
      const role = await Role.findById(roleId)
      if (!role) {
        res.status(400).json({ message: 'Invalid roleId' })
        return
      }
      $set.roleId = role._id
    }
    if (active !== undefined) $set.active = active
    if (allowOfflineLogin !== undefined) $set.allowOfflineLogin = allowOfflineLogin
    if (allowShopAssistCatalogAdjustment !== undefined) {
      $set.allowShopAssistCatalogAdjustment = allowShopAssistCatalogAdjustment
    }
    if (canLogin !== undefined) $set['legacy.canLogin'] = canLogin
    if (email !== undefined) $set.email = email.toLowerCase().trim()
    if (displayName !== undefined) {
      const v = displayName.trim()
      if (v) $set.displayName = v
      else $unset.displayName = 1
    }
    if (badgeCode !== undefined) {
      const v = badgeCode.trim()
      if (v) $set.badgeCode = v
      else $unset.badgeCode = 1
    }

    if (hrProfile !== undefined) {
      if (hrProfile === null) {
        $unset.hrProfile = 1
      } else if (hrProfile && typeof hrProfile === 'object') {
        const next: Record<string, unknown> = {}
        const phone = parseOptionalString(hrProfile.phone)
        if (phone !== undefined) next.phone = phone
        const startDate = parseOptionalDate(hrProfile.startDate)
        if (startDate !== undefined) next.startDate = startDate
        const paymentTerms = parsePaymentTerms(hrProfile.paymentTerms)
        if (paymentTerms !== undefined) next.paymentTerms = paymentTerms
        const paymentAmount = parseOptionalMoney(hrProfile.paymentAmount)
        if (paymentAmount !== undefined) next.paymentAmount = paymentAmount
        const notes = parseOptionalString(hrProfile.notes)
        if (notes !== undefined) next.notes = notes
        const scoreCard = parseOptionalString(hrProfile.scoreCard)
        if (scoreCard !== undefined) next.scoreCard = scoreCard
        const loans = parseStaffLoans(hrProfile.loans)
        if (loans !== undefined) next.loans = loans

        const hrKeys = Object.keys(next)
        if (hrKeys.length === 0) {
          res.status(400).json({ message: 'No valid hrProfile fields to update' })
          return
        }
        for (const key of hrKeys) {
          $set[`hrProfile.${key}`] = next[key]
        }
      }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      res.status(400).json({ message: 'No fields to update' })
      return
    }

    const update: Record<string, unknown> = {}
    if (Object.keys($set).length > 0) update.$set = $set
    if (Object.keys($unset).length > 0) update.$unset = $unset

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()

    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    res.json(serializeUser(user as PopulatedUser))
  } catch (err) {
    next(err)
  }
}

export async function setUserPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { password } = req.body as { password?: string }
    if (!password || password.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters' })
      return
    }

    const passwordHash = await hashPassword(password)
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          passwordHash,
          active: true,
          'legacy.canLogin': true,
        },
      },
      { new: true },
    )
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()

    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    res.json(serializeUser(user as PopulatedUser))
  } catch (err) {
    next(err)
  }
}

export async function enrollUserFace(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const { samples, staffConsent, consentVersion } = req.body as {
      samples?: unknown
      staffConsent?: unknown
      consentVersion?: unknown
    }
    if (staffConsent !== true) {
      res.status(400).json({
        message: 'staffConsent must be true — record the staff member’s consent before enrolling',
      })
      return
    }
    const version = String(consentVersion ?? '').trim()
    if (version !== STAFF_FACE_ENROLLMENT_CONSENT_VERSION) {
      res.status(400).json({
        message: `consentVersion must be ${STAFF_FACE_ENROLLMENT_CONSENT_VERSION}`,
      })
      return
    }
    if (!Array.isArray(samples) || samples.length < 1 || samples.length > 8) {
      res.status(400).json({ message: 'samples must be an array of 1–8 face embeddings' })
      return
    }
    const parsed: number[][] = []
    for (const raw of samples) {
      const emb = validateFaceEmbedding(raw)
      if (!emb) {
        res.status(400).json({ message: 'Each sample must be a 128-number face embedding' })
        return
      }
      parsed.push(emb)
    }
    const embedding = averageEmbeddings(parsed)
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          faceEnrollment: {
            embedding,
            modelId: FACE_MODEL_ID,
            sampleCount: parsed.length,
            enrolledAt: new Date(),
            enrolledBy: new Types.ObjectId(req.user.id),
            staffConsentAt: new Date(),
            staffConsentRecordedBy: new Types.ObjectId(req.user.id),
            consentVersion: version,
          },
        },
      },
      { new: true, runValidators: true },
    )
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    const serialized = serializeUser(user as PopulatedUser)
    serialized.hasFaceEnrollment = true
    res.json(serialized)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'DIM_MISMATCH' || msg === 'NO_SAMPLES') {
      res.status(400).json({ message: 'Invalid face samples' })
      return
    }
    next(err)
  }
}

export async function removeUserFace(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $unset: { faceEnrollment: 1 } },
      { new: true },
    )
      .populate<{ roleId: IRole }>('roleId')
      .select('-passwordHash -refreshTokenHash -refreshTokenExpires')
      .lean()
    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    res.json(serializeUser(user as PopulatedUser))
  } catch (err) {
    next(err)
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const targetId = req.params.id
    if (!targetId) {
      res.status(400).json({ message: 'User id required' })
      return
    }
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    if (req.user.id === targetId) {
      res.status(400).json({ message: 'You cannot delete your own account' })
      return
    }

    const adminRole = await Role.findOne({ slug: 'admin' })
    if (!adminRole) {
      res.status(500).json({ message: 'Roles not configured' })
      return
    }

    const target = await User.findById(targetId).select('roleId').lean()
    if (!target) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    if (String(target.roleId) === String(adminRole._id)) {
      const adminCount = await User.countDocuments({ roleId: adminRole._id })
      if (adminCount <= 1) {
        res.status(400).json({ message: 'Cannot delete the last administrator' })
        return
      }
    }

    await User.findByIdAndDelete(targetId)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

export async function getUserPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    const targetId = req.params.id
    if (!Types.ObjectId.isValid(targetId)) {
      res.status(400).json({ message: 'Invalid user id' })
      return
    }
    const exists = await User.findById(targetId).select('_id').lean()
    if (!exists) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    const summary = await buildUserPerformance(targetId, req.query.days)
    res.json(summary)
  } catch (err) {
    next(err)
  }
}

export async function getUserSoldBySales(req: Request, res: Response, next: NextFunction) {
  try {
    const targetId = req.params.id
    if (!Types.ObjectId.isValid(targetId)) {
      res.status(400).json({ message: 'Invalid user id' })
      return
    }
    const exists = await User.findById(targetId).select('_id').lean()
    if (!exists) {
      res.status(404).json({ message: 'User not found' })
      return
    }
    const report = await buildUserSoldBySales(targetId, req.query.days)
    res.json(report)
  } catch (err) {
    next(err)
  }
}
