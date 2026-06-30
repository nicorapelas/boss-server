import { Types } from 'mongoose'
import { HouseAccount, HouseAccountLedger } from '../models/HouseAccount.js'
import { Sale } from '../models/Sale.js'
import { StoreSettings } from '../models/StoreSettings.js'

const ZERO_BALANCE_TOLERANCE = 0.01

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type HouseAccountStatementLineItem = {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type HouseAccountStatementChargeDetail = {
  saleId?: string
  tillCode?: string
  purchaseOrderNumber?: string
  onAccountAmount: number
  saleTotal: number
  cashAmount?: number
  cardAmount?: number
  items: HouseAccountStatementLineItem[]
  summaryOnly?: boolean
}

export type HouseAccountStatementRow = {
  id: string
  date: string
  kind: 'charge' | 'payment'
  debit: number
  credit: number
  balanceAfter: number
  note?: string
  cashAmount?: number
  cardAmount?: number
  charge?: HouseAccountStatementChargeDetail
}

export type HouseAccountStatement = {
  generatedAt: string
  periodMode: 'since_last_zero' | 'custom'
  periodFrom: string
  periodTo: string
  lastZeroAt: string | null
  store: {
    name: string
    addressLines: string[]
    phone: string
    vatNumber: string
  }
  account: {
    _id: string
    accountNumber: string
    name: string
    phone: string
    contactPerson: string
    email: string
    vatNumber: string
    companyRegistrationNumber: string
    addressLines: string[]
    paymentTerms: string
    balance: number
    creditLimit: number | null
    status: string
  }
  openingBalance: number
  closingBalance: number
  rows: HouseAccountStatementRow[]
}

type LedgerLean = {
  _id: Types.ObjectId
  kind: 'charge' | 'payment'
  amount: number
  saleId?: Types.ObjectId | null
  cashAmount?: number
  cardAmount?: number
  note?: string
  createdAt?: Date
}

function ledgerDelta(kind: 'charge' | 'payment', amount: number): number {
  return kind === 'charge' ? amount : -amount
}

function findLastZeroBalanceIndex(entries: Array<{ kind: 'charge' | 'payment'; amount: number }>): number {
  let balance = 0
  let lastZeroIdx = -1
  for (let i = 0; i < entries.length; i++) {
    balance = round2(balance + ledgerDelta(entries[i].kind, entries[i].amount))
    if (balance <= ZERO_BALANCE_TOLERANCE) {
      lastZeroIdx = i
    }
  }
  return lastZeroIdx
}

function balanceBeforeIndex(entries: Array<{ kind: 'charge' | 'payment'; amount: number }>, endExclusive: number): number {
  let balance = 0
  for (let i = 0; i < endExclusive; i++) {
    balance = round2(balance + ledgerDelta(entries[i].kind, entries[i].amount))
  }
  return balance
}

function parseStatementDate(raw: unknown, endOfDay: boolean): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const d = new Date(raw.trim())
  if (Number.isNaN(d.getTime())) return null
  if (endOfDay) {
    d.setHours(23, 59, 59, 999)
  } else {
    d.setHours(0, 0, 0, 0)
  }
  return d
}

export async function buildHouseAccountStatement(
  accountId: string,
  opts?: { from?: Date | null; to?: Date | null },
): Promise<HouseAccountStatement | null> {
  if (!Types.ObjectId.isValid(accountId)) return null

  const acct = await HouseAccount.findById(accountId).lean()
  if (!acct) return null

  const allEntries = (await HouseAccountLedger.find({ houseAccountId: accountId })
    .sort({ createdAt: 1, _id: 1 })
    .lean()) as LedgerLean[]

  const periodMode: HouseAccountStatement['periodMode'] = opts?.from ? 'custom' : 'since_last_zero'
  const lastZeroIdx = findLastZeroBalanceIndex(allEntries)
  const lastZeroAt =
    lastZeroIdx >= 0 && allEntries[lastZeroIdx]?.createdAt
      ? new Date(allEntries[lastZeroIdx].createdAt!).toISOString()
      : null

  let periodEntries = allEntries
  let openingBalance = 0

  if (periodMode === 'since_last_zero') {
    const startIdx = lastZeroIdx + 1
    openingBalance = balanceBeforeIndex(allEntries, startIdx)
    periodEntries = allEntries.slice(startIdx)
  } else {
    const from = opts?.from ?? null
    const to = opts?.to ?? null
    let bal = 0
    for (const e of allEntries) {
      const t = e.createdAt ? new Date(e.createdAt) : null
      if (from && t && t < from) {
        bal = round2(bal + ledgerDelta(e.kind, e.amount))
      }
    }
    openingBalance = bal
    periodEntries = allEntries.filter((e) => {
      const t = e.createdAt ? new Date(e.createdAt) : null
      if (!t) return !from && !to
      if (from && t < from) return false
      if (to && t > to) return false
      return true
    })
  }

  const periodFrom =
    periodEntries[0]?.createdAt != null
      ? new Date(periodEntries[0].createdAt!).toISOString()
      : periodMode === 'since_last_zero' && lastZeroAt
        ? lastZeroAt
        : opts?.from?.toISOString() ?? new Date().toISOString()

  const periodTo =
    periodEntries.length > 0
      ? new Date(periodEntries[periodEntries.length - 1].createdAt ?? Date.now()).toISOString()
      : new Date().toISOString()

  const saleIds = [
    ...new Set(
      periodEntries
        .filter((e) => e.kind === 'charge' && e.saleId)
        .map((e) => String(e.saleId)),
    ),
  ].filter((id) => Types.ObjectId.isValid(id))

  const sales =
    saleIds.length > 0
      ? await Sale.find({ _id: { $in: saleIds } })
          .select(
            'saleId items total onAccountAmount payment purchaseOrderNumber tillCode createdAt storeCreditAmount',
          )
          .lean()
      : []
  const saleById = new Map(sales.map((s) => [String(s._id), s]))

  let running = round2(openingBalance)
  const rows: HouseAccountStatementRow[] = []

  for (const entry of periodEntries) {
    const debit = entry.kind === 'charge' ? round2(entry.amount) : 0
    const credit = entry.kind === 'payment' ? round2(entry.amount) : 0
    running = round2(running + debit - credit)

    const row: HouseAccountStatementRow = {
      id: String(entry._id),
      date: entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString(),
      kind: entry.kind,
      debit,
      credit,
      balanceAfter: running,
      note: entry.note?.trim() || undefined,
      cashAmount: entry.cashAmount,
      cardAmount: entry.cardAmount,
    }

    if (entry.kind === 'charge') {
      const sale = entry.saleId ? saleById.get(String(entry.saleId)) : undefined
      if (sale) {
        const items = (sale.items ?? []).map((it) => ({
          name: String(it.name ?? ''),
          quantity: Number(it.quantity ?? 0),
          unitPrice: round2(Number(it.unitPrice ?? 0)),
          lineTotal: round2(Number(it.lineTotal ?? Number(it.unitPrice ?? 0) * Number(it.quantity ?? 0))),
        }))
        row.charge = {
          saleId: sale.saleId ?? String(sale._id).slice(-10),
          tillCode: sale.tillCode?.trim() || undefined,
          purchaseOrderNumber: sale.purchaseOrderNumber?.trim() || undefined,
          onAccountAmount: round2(Number(sale.onAccountAmount ?? entry.amount)),
          saleTotal: round2(Number(sale.total ?? 0)),
          cashAmount: sale.payment?.cashAmount != null ? round2(Number(sale.payment.cashAmount)) : undefined,
          cardAmount: sale.payment?.cardAmount != null ? round2(Number(sale.payment.cardAmount)) : undefined,
          items,
        }
      } else {
        row.charge = {
          onAccountAmount: debit,
          saleTotal: debit,
          items: [],
          summaryOnly: true,
        }
      }
    }

    rows.push(row)
  }

  const settings = await StoreSettings.findById('default').lean()

  return {
    generatedAt: new Date().toISOString(),
    periodMode,
    periodFrom,
    periodTo,
    lastZeroAt,
    store: {
      name: settings?.storeName?.trim() || 'Store',
      addressLines: settings?.storeAddressLines ?? [],
      phone: settings?.storePhone?.trim() || '',
      vatNumber: settings?.storeVatNumber?.trim() || '',
    },
    account: {
      _id: String(acct._id),
      accountNumber: acct.accountNumber,
      name: acct.name,
      phone: acct.phone ?? '',
      contactPerson: acct.contactPerson ?? '',
      email: acct.email ?? '',
      vatNumber: acct.vatNumber ?? '',
      companyRegistrationNumber: acct.companyRegistrationNumber ?? '',
      addressLines: acct.addressLines ?? [],
      paymentTerms: acct.paymentTerms ?? '',
      balance: round2(acct.balance ?? 0),
      creditLimit: acct.creditLimit ?? null,
      status: acct.status,
    },
    openingBalance: round2(openingBalance),
    closingBalance: round2(acct.balance ?? 0),
    rows,
  }
}

export function parseHouseAccountStatementQuery(query: Record<string, unknown>): {
  from: Date | null
  to: Date | null
} {
  const from = parseStatementDate(query.from, false)
  const to = parseStatementDate(query.to, true)
  return { from, to }
}
