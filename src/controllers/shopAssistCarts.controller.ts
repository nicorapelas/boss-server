import { randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Product } from '../models/Product.js'
import { ShopAssistCart, type IShopAssistCartLine } from '../models/ShopAssistCart.js'
import { hashToken } from '../utils/tokenHash.js'

const CART_TOKEN_PREFIX = 'shopassist-cart:'
const CART_TTL_MS = 60 * 60 * 1000
const MAX_LINES = 100

type CartLineBody = {
  productId?: string
  quantity?: number
}

type ProductSnapshot = {
  _id: unknown
  sku: string
  barcode?: string | null
  name: string
  price: number
}

function parseToken(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith(CART_TOKEN_PREFIX)) {
    return trimmed.slice(CART_TOKEN_PREFIX.length).trim()
  }
  return trimmed
}

function serializeCart(cart: {
  _id: unknown
  status: string
  lines: IShopAssistCartLine[]
  createdByEmail?: string
  expiresAt: Date
  claimedAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}, token?: string) {
  return {
    _id: String(cart._id),
    status: cart.status,
    ...(token ? { token, qrPayload: `${CART_TOKEN_PREFIX}${token}` } : {}),
    createdByEmail: cart.createdByEmail,
    expiresAt: cart.expiresAt,
    claimedAt: cart.claimedAt ?? null,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
    lines: cart.lines.map((line) => ({
      productId: String(line.productId),
      sku: line.sku,
      barcode: line.barcode ?? null,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  }
}

async function buildLines(rawLines: unknown): Promise<IShopAssistCartLine[] | null> {
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > MAX_LINES) return null

  const qtyByProduct = new Map<string, number>()
  for (const raw of rawLines as CartLineBody[]) {
    const productId = typeof raw.productId === 'string' ? raw.productId.trim() : ''
    if (!Types.ObjectId.isValid(productId)) return null
    const qty = Math.floor(Number(raw.quantity))
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) return null
    qtyByProduct.set(productId, (qtyByProduct.get(productId) ?? 0) + qty)
  }

  const ids = [...qtyByProduct.keys()]
  const products = (await Product.find({ _id: { $in: ids } })
    .select('sku barcode name price')
    .lean()) as ProductSnapshot[]
  const byId = new Map(products.map((p) => [String(p._id), p]))
  const out: IShopAssistCartLine[] = []

  for (const id of ids) {
    const p = byId.get(id)
    if (!p) return null
    out.push({
      productId: new Types.ObjectId(id),
      sku: p.sku,
      barcode: p.barcode ?? null,
      name: p.name,
      quantity: qtyByProduct.get(id) ?? 1,
      unitPrice: Math.round(Number(p.price) * 100) / 100,
    })
  }

  return out
}

export async function createShopAssistCart(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }

    const lines = await buildLines((req.body as { lines?: unknown }).lines)
    if (!lines) {
      res.status(400).json({ message: 'Cart must include 1-100 valid product lines.' })
      return
    }

    const token = randomBytes(18).toString('base64url')
    const cart = await ShopAssistCart.create({
      tokenHash: hashToken(token),
      status: 'ready',
      lines,
      createdBy: new Types.ObjectId(String(req.user.id)),
      createdByEmail: req.user.email,
      expiresAt: new Date(Date.now() + CART_TTL_MS),
    })

    res.status(201).json(serializeCart(cart, token))
  } catch (e) {
    next(e)
  }
}

export async function claimShopAssistCart(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }

    const token = parseToken((req.body as { token?: unknown }).token)
    if (!token) {
      res.status(400).json({ message: 'Cart token required.' })
      return
    }

    const now = new Date()
    const claimed = await ShopAssistCart.findOneAndUpdate(
      { tokenHash: hashToken(token), status: 'ready', expiresAt: { $gt: now } },
      {
        $set: {
          status: 'claimed',
          claimedBy: new Types.ObjectId(String(req.user.id)),
          claimedAt: now,
        },
      },
      { new: true },
    )

    if (claimed) {
      res.json(serializeCart(claimed))
      return
    }

    const cart = await ShopAssistCart.findOne({ tokenHash: hashToken(token) })
    if (!cart) {
      res.status(404).json({ message: 'ShopAssist cart not found.' })
      return
    }
    if (cart.status === 'claimed') {
      res.status(409).json({ message: 'This ShopAssist cart has already been imported.' })
      return
    }
    if (cart.expiresAt <= now) {
      if (cart.status !== 'expired') {
        cart.status = 'expired'
        await cart.save()
      }
      res.status(410).json({ message: 'This ShopAssist cart has expired.' })
      return
    }
    res.status(409).json({ message: 'ShopAssist cart is not ready to import.' })
  } catch (e) {
    next(e)
  }
}
