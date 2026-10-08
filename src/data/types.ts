import type { Unit } from '../lib/units'

/** Calendar day in Europe/Sofia, formatted YYYY-MM-DD. */
export type ISODate = string

export interface ProductGroup {
  id: string
  name: string
  sortOrder: number
  archived: boolean
}

export interface Product {
  id: string
  groupId: string
  name: string
  unit: Unit
  sortOrder: number
  archived: boolean
}

export interface DailyEntry {
  productId: string
  date: ISODate
  produced: number
  wasted: number
}

/** How the two daily product numbers are worded for this business. */
export type EntryLabels = 'made_thrown' | 'sent_returned'

export interface BusinessSettings {
  entryLabels: EntryLabels
}

/** A raw material such as flour or sugar. */
export interface Supply {
  id: string
  name: string
  unit: Unit
  /** Warn when stock is at or below this; null for no warning. */
  lowStockAt: number | null
  sortOrder: number
  archived: boolean
}

/** One supply on one day. `counted`: actual stock at the end of that day. */
export interface SupplyDay {
  supplyId: string
  date: ISODate
  received: number
  used: number
  counted: number | null
}

export interface SupplyStock {
  stock: number
  /** Date of the last count it's based on; null if never counted. */
  countedOn: ISODate | null
}

/**
 * Everything the screens need from storage. The demo build uses a
 * localStorage implementation; Supabase will implement the same interface.
 */
export interface DataStore {
  listGroups(): Promise<ProductGroup[]>
  listProducts(): Promise<Product[]>
  listEntries(from: ISODate, to: ISODate): Promise<DailyEntry[]>
  saveEntry(entry: DailyEntry): Promise<void>
  saveGroup(group: ProductGroup): Promise<void>
  saveProduct(product: Product): Promise<void>
  /** Permanently deletes a group with all its products and their numbers. */
  deleteGroup(id: string): Promise<void>
  /** Permanently deletes a product and all its numbers. */
  deleteProduct(id: string): Promise<void>

  getSettings(): Promise<BusinessSettings>
  saveSettings(settings: BusinessSettings): Promise<void>

  listSupplies(): Promise<Supply[]>
  saveSupply(supply: Supply): Promise<void>
  /** Permanently deletes a supply and its history. */
  deleteSupply(id: string): Promise<void>
  listSupplyDays(from: ISODate, to: ISODate): Promise<SupplyDay[]>
  saveSupplyDay(day: SupplyDay): Promise<void>
  /** Current stock per supply id. */
  supplyStock(): Promise<Record<string, SupplyStock>>
}
