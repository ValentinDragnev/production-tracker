import type { SupabaseClient } from '@supabase/supabase-js'
import type { Unit } from '../lib/units'
import type {
  BusinessSettings,
  DailyEntry,
  DataStore,
  ISODate,
  Product,
  ProductGroup,
  Supply,
  SupplyDay,
  SupplyStock,
} from './types'

interface GroupRow {
  id: string
  name: string
  sort_order: number
  archived: boolean
}

interface ProductRow extends GroupRow {
  group_id: string
  unit: Unit
}

// Postgres numeric can arrive as a string; always hand the app numbers.
type Num = number | string

interface EntryRow {
  product_id: string
  date: ISODate
  produced: Num
  wasted: Num
}

interface SupplyRow extends GroupRow {
  unit: Unit
  low_stock_at: Num | null
}

interface SupplyDayRow {
  supply_id: string
  date: ISODate
  received: Num
  used: Num
  counted: Num | null
}

const num = (v: Num) => Number(v)

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
      .select('id, group_id, name, unit, sort_order, archived')
      .eq('business_id', this.businessId)
    if (error) throw error
    return (data as ProductRow[]).map((p) => ({
      id: p.id,
      groupId: p.group_id,
      name: p.name,
      unit: p.unit,
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
      produced: num(e.produced),
      wasted: num(e.wasted),
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
      unit: product.unit,
      sort_order: product.sortOrder,
      archived: product.archived,
    })
    if (error) throw error
  }

  async getSettings(): Promise<BusinessSettings> {
    const { data, error } = await this.client.from('businesses').select('entry_labels').eq('id', this.businessId).single()
    // Before the database change is applied, fall back to the default wording.
    if (error) return { entryLabels: 'made_thrown' }
    return { entryLabels: data.entry_labels }
  }

  async saveSettings(settings: BusinessSettings): Promise<void> {
    const { error } = await this.client
      .from('businesses')
      .update({ entry_labels: settings.entryLabels })
      .eq('id', this.businessId)
    if (error) throw error
  }

  async listSupplies(): Promise<Supply[]> {
    const { data, error } = await this.client
      .from('supplies')
      .select('id, name, unit, low_stock_at, sort_order, archived')
      .eq('business_id', this.businessId)
    if (error) throw error
    return (data as SupplyRow[]).map((s) => ({
      id: s.id,
      name: s.name,
      unit: s.unit,
      lowStockAt: s.low_stock_at === null ? null : num(s.low_stock_at),
      sortOrder: s.sort_order,
      archived: s.archived,
    }))
  }

  async saveSupply(supply: Supply): Promise<void> {
    const { error } = await this.client.from('supplies').upsert({
      id: supply.id,
      business_id: this.businessId,
      name: supply.name,
      unit: supply.unit,
      low_stock_at: supply.lowStockAt,
      sort_order: supply.sortOrder,
      archived: supply.archived,
    })
    if (error) throw error
  }

  async deleteSupply(id: string): Promise<void> {
    const { error } = await this.client.from('supplies').delete().eq('id', id).eq('business_id', this.businessId)
    if (error) throw error
  }

  async listSupplyDays(from: ISODate, to: ISODate): Promise<SupplyDay[]> {
    const { data, error } = await this.client
      .from('supply_days')
      .select('supply_id, date, received, used, counted')
      .eq('business_id', this.businessId)
      .gte('date', from)
      .lte('date', to)
    if (error) throw error
    return (data as SupplyDayRow[]).map((d) => ({
      supplyId: d.supply_id,
      date: d.date,
      received: num(d.received),
      used: num(d.used),
      counted: d.counted === null ? null : num(d.counted),
    }))
  }

  async saveSupplyDay(day: SupplyDay): Promise<void> {
    const { error } = await this.client.from('supply_days').upsert(
      {
        business_id: this.businessId,
        supply_id: day.supplyId,
        date: day.date,
        received: day.received,
        used: day.used,
        counted: day.counted,
      },
      { onConflict: 'supply_id,date' },
    )
    if (error) throw error
  }

  async supplyStock(): Promise<Record<string, SupplyStock>> {
    const { data, error } = await this.client.rpc('supply_stock', { bid: this.businessId })
    if (error) throw error
    return Object.fromEntries(
      (data as { supply_id: string; stock: Num; counted_on: ISODate | null }[]).map((r) => [
        r.supply_id,
        { stock: num(r.stock), countedOn: r.counted_on },
      ]),
    )
  }
}
