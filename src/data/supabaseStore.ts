import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyEntry, DataStore, ISODate, Product, ProductGroup } from './types'

interface GroupRow {
  id: string
  name: string
  sort_order: number
  archived: boolean
}

interface ProductRow extends GroupRow {
  group_id: string
}

interface EntryRow {
  product_id: string
  date: ISODate
  produced: number
  wasted: number
}

/** Reads and writes one business's data. Row-level security does the access checks. */
export class SupabaseStore implements DataStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly businessId: string,
  ) {}

  async listGroups(): Promise<ProductGroup[]> {
    const { data, error } = await this.client
      .from('product_groups')
      .select('id, name, sort_order, archived')
      .eq('business_id', this.businessId)
    if (error) throw error
    return (data as GroupRow[]).map((g) => ({ id: g.id, name: g.name, sortOrder: g.sort_order, archived: g.archived }))
  }

  async listProducts(): Promise<Product[]> {
    const { data, error } = await this.client
      .from('products')
      .select('id, group_id, name, sort_order, archived')
      .eq('business_id', this.businessId)
    if (error) throw error
    return (data as ProductRow[]).map((p) => ({
      id: p.id,
      groupId: p.group_id,
      name: p.name,
      sortOrder: p.sort_order,
      archived: p.archived,
    }))
  }

  async listEntries(from: ISODate, to: ISODate): Promise<DailyEntry[]> {
    const { data, error } = await this.client
      .from('daily_entries')
      .select('product_id, date, produced, wasted')
      .eq('business_id', this.businessId)
      .gte('date', from)
      .lte('date', to)
    if (error) throw error
    return (data as EntryRow[]).map((e) => ({
      productId: e.product_id,
      date: e.date,
      produced: e.produced,
      wasted: e.wasted,
    }))
  }

  async saveEntry(entry: DailyEntry): Promise<void> {
    const { error } = await this.client.from('daily_entries').upsert(
      {
        business_id: this.businessId,
        product_id: entry.productId,
        date: entry.date,
        produced: entry.produced,
        wasted: entry.wasted,
      },
      { onConflict: 'product_id,date' },
    )
    if (error) throw error
  }

  async saveGroup(group: ProductGroup): Promise<void> {
    const { error } = await this.client.from('product_groups').upsert({
      id: group.id,
      business_id: this.businessId,
      name: group.name,
      sort_order: group.sortOrder,
      archived: group.archived,
    })
    if (error) throw error
  }

  // Products and numbers go with them through cascading foreign keys.
  async deleteGroup(id: string): Promise<void> {
    const { error } = await this.client.from('product_groups').delete().eq('id', id).eq('business_id', this.businessId)
    if (error) throw error
  }

  async deleteProduct(id: string): Promise<void> {
    const { error } = await this.client.from('products').delete().eq('id', id).eq('business_id', this.businessId)
    if (error) throw error
  }

  async saveProduct(product: Product): Promise<void> {
    const { error } = await this.client.from('products').upsert({
      id: product.id,
      business_id: this.businessId,
      group_id: product.groupId,
      name: product.name,
      sort_order: product.sortOrder,
      archived: product.archived,
    })
    if (error) throw error
  }
}
