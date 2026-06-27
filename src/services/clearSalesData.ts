import { HouseAccount, HouseAccountLedger } from '../models/HouseAccount.js'
import { LayBy } from '../models/LayBy.js'
import {
  LoyaltyLedger,
  LoyaltyMember,
  LoyaltyPhoneChange,
} from '../models/LoyaltyMember.js'
import { OfflineSyncConflict } from '../models/OfflineSyncConflict.js'
import { OpenTab } from '../models/OpenTab.js'
import { Quote } from '../models/Quote.js'
import { Sale } from '../models/Sale.js'
import { SaleRefund } from '../models/SaleRefund.js'
import { ShiftSession } from '../models/ShiftSession.js'
import { ShopAssistCart } from '../models/ShopAssistCart.js'
import { StockAdjustmentLog } from '../models/StockAdjustmentLog.js'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'

export type ClearSalesDataResult = {
  deleted: Record<string, number>
  reset: Record<string, number>
}

/**
 * Remove transactional sales history for go-live / test reset.
 * Keeps catalog (products, suppliers), users, roles, store settings, and terminal config.
 */
export async function clearSalesData(): Promise<ClearSalesDataResult> {
  const deleted: Record<string, number> = {}
  const reset: Record<string, number> = {}

  const deleteCounts = await Promise.all([
    SaleRefund.deleteMany({}).then((r) => {
      deleted.saleRefunds = r.deletedCount ?? 0
    }),
    Sale.deleteMany({}).then((r) => {
      deleted.sales = r.deletedCount ?? 0
    }),
    ShiftSession.deleteMany({}).then((r) => {
      deleted.shiftSessions = r.deletedCount ?? 0
    }),
    OpenTab.deleteMany({}).then((r) => {
      deleted.openTabs = r.deletedCount ?? 0
    }),
    LayBy.deleteMany({}).then((r) => {
      deleted.layBys = r.deletedCount ?? 0
    }),
    Quote.deleteMany({}).then((r) => {
      deleted.quotes = r.deletedCount ?? 0
    }),
    HouseAccountLedger.deleteMany({}).then((r) => {
      deleted.houseAccountLedger = r.deletedCount ?? 0
    }),
    StoreCreditLedger.deleteMany({}).then((r) => {
      deleted.storeCreditLedger = r.deletedCount ?? 0
    }),
    LoyaltyLedger.deleteMany({}).then((r) => {
      deleted.loyaltyLedger = r.deletedCount ?? 0
    }),
    LoyaltyPhoneChange.deleteMany({}).then((r) => {
      deleted.loyaltyPhoneChanges = r.deletedCount ?? 0
    }),
    OfflineSyncConflict.deleteMany({}).then((r) => {
      deleted.offlineSyncConflicts = r.deletedCount ?? 0
    }),
    ShopAssistCart.deleteMany({}).then((r) => {
      deleted.shopAssistCarts = r.deletedCount ?? 0
    }),
    StockAdjustmentLog.deleteMany({}).then((r) => {
      deleted.stockAdjustmentLogs = r.deletedCount ?? 0
    }),
  ])
  void deleteCounts

  const [houseAccounts, storeCreditAccounts, loyaltyMembers] = await Promise.all([
    HouseAccount.updateMany({}, { $set: { balance: 0 } }),
    StoreCreditAccount.updateMany({}, { $set: { balance: 0 } }),
    LoyaltyMember.updateMany({}, { $set: { pointsBalance: 0 } }),
  ])
  reset.houseAccountBalances = houseAccounts.modifiedCount ?? 0
  reset.storeCreditBalances = storeCreditAccounts.modifiedCount ?? 0
  reset.loyaltyPointsBalances = loyaltyMembers.modifiedCount ?? 0

  return { deleted, reset }
}
