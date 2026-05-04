import mongoose, { Schema } from 'mongoose'

export interface IProductPriceTiers {
  price1?: number
  price2?: number
  price3?: number
  price4?: number
  price5?: number
  price6?: number
}

export interface IProductDepartment {
  code?: number
  name?: string
}

export interface IProductTax {
  code?: number
  altCode?: number
}

export interface IProductCost {
  average?: number
  last?: number
}

export interface IProductLegacy {
  source: 'vector'
  itemNo: number
  itemType: number
  stockType?: number
  stockLoc?: number
  qtyMass?: number
  textReference?: string
}

export interface IProductVolumeTier {
  minQty: number
  maxQty: number | null
  unitPrice: number
}

export interface IProduct {
  name: string
  sku: string
  category?: string | null
  /** Optional finer grouping under `category` (BackOffice catalog + API). */
  subCategory?: string | null
  /** Line quantity picks one tier; that unit price applies to the whole line. See `utils/volumePrice`. */
  volumeTieringEnabled?: boolean
  volumeTiers?: IProductVolumeTier[]
  barcode?: string | null
  longName?: string | null
  price: number
  stock: number
  /** When false, item is service/labour — not quantity-limited by stock. Defaults to true. */
  trackInventory?: boolean
  enabled?: boolean
  department?: IProductDepartment
  group?: IProductDepartment
  tax?: IProductTax
  cost?: IProductCost
  priceTiers?: IProductPriceTiers
  legacy?: IProductLegacy
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true },
    category: { type: String, trim: true, default: null, index: true },
    subCategory: { type: String, trim: true, default: null, index: true },
    volumeTieringEnabled: { type: Boolean, default: false },
    volumeTiers: {
      type: [
        {
          minQty: { type: Number, required: true, min: 1 },
          maxQty: { type: Number, min: 1, default: null },
          unitPrice: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    barcode: { type: String, trim: true, index: true, sparse: true },
    longName: { type: String, trim: true, default: null },
    price: { type: Number, required: true, min: 0, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    trackInventory: { type: Boolean, default: true },
    enabled: { type: Boolean, default: true },
    department: {
      code: { type: Number },
      name: { type: String, trim: true },
    },
    group: {
      code: { type: Number },
      name: { type: String, trim: true },
    },
    tax: {
      code: { type: Number },
      altCode: { type: Number },
    },
    cost: {
      average: { type: Number },
      last: { type: Number },
    },
    priceTiers: {
      price1: { type: Number },
      price2: { type: Number },
      price3: { type: Number },
      price4: { type: Number },
      price5: { type: Number },
      price6: { type: Number },
    },
    legacy: {
      source: { type: String, enum: ['vector'] },
      itemNo: { type: Number },
      itemType: { type: Number },
      stockType: { type: Number },
      stockLoc: { type: Number },
      qtyMass: { type: Number },
      textReference: { type: String, trim: true },
    },
  },
  { timestamps: true },
)

productSchema.index(
  { 'legacy.source': 1, 'legacy.itemNo': 1, 'legacy.itemType': 1 },
  { unique: true, sparse: true },
)

export const Product = mongoose.model<IProduct>('Product', productSchema)
