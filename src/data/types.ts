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
  sortOrder: number
  archived: boolean
}

export interface DailyEntry {
  productId: string
  date: ISODate
  produced: number
  wasted: number
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
}
