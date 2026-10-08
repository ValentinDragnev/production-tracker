import { addDays, todayInSofia } from '../lib/dates'
import { computeStock } from '../lib/stock'
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

const STORAGE_KEY = 'production-tracker:demo:v1'

interface Snapshot {
  groups: ProductGroup[]
  products: Product[]
  entries: Record<string, DailyEntry>
  settings: BusinessSettings
  supplies: Supply[]
  supplyDays: Record<string, SupplyDay>
}

const entryKey = (productId: string, date: ISODate) => `${productId}|${date}`

/**
 * Demo store that keeps everything in this browser's localStorage.
 * Seeded with three weeks of sample data on first run.
 */
export class LocalStore implements DataStore {
  private snapshot: Snapshot

  constructor() {
    this.snapshot = load() ?? seed()
    this.persist()
  }

  async listGroups() {
    return this.snapshot.groups.map((g) => ({ ...g }))
  }

  async listProducts() {
    return this.snapshot.products.map((p) => ({ ...p }))
  }

  async listEntries(from: ISODate, to: ISODate) {
    return Object.values(this.snapshot.entries).filter((e) => e.date >= from && e.date <= to)
  }

  async saveEntry(entry: DailyEntry) {
    const key = entryKey(entry.productId, entry.date)
    if (entry.produced === 0 && entry.wasted === 0) delete this.snapshot.entries[key]
    else this.snapshot.entries[key] = { ...entry }
    this.persist()
  }

  async saveGroup(group: ProductGroup) {
    this.snapshot.groups = upsert(this.snapshot.groups, group)
    this.persist()
  }

  async saveProduct(product: Product) {
    this.snapshot.products = upsert(this.snapshot.products, product)
    this.persist()
  }

  async deleteGroup(id: string) {
    const productIds = this.snapshot.products.filter((p) => p.groupId === id).map((p) => p.id)
    this.snapshot.groups = this.snapshot.groups.filter((g) => g.id !== id)
    this.removeProducts(productIds)
  }

  async deleteProduct(id: string) {
    this.removeProducts([id])
  }

  private removeProducts(ids: string[]) {
    const gone = new Set(ids)
    this.snapshot.products = this.snapshot.products.filter((p) => !gone.has(p.id))
    for (const [key, entry] of Object.entries(this.snapshot.entries)) {
      if (gone.has(entry.productId)) delete this.snapshot.entries[key]
    }
    this.persist()
  }

  async getSettings() {
    return { ...this.snapshot.settings }
  }

  async saveSettings(settings: BusinessSettings) {
    this.snapshot.settings = { ...settings }
    this.persist()
  }

  async listSupplies() {
    return this.snapshot.supplies.map((s) => ({ ...s }))
  }

  async saveSupply(supply: Supply) {
    this.snapshot.supplies = upsert(this.snapshot.supplies, supply)
    this.persist()
  }

  async deleteSupply(id: string) {
    this.snapshot.supplies = this.snapshot.supplies.filter((s) => s.id !== id)
    for (const [key, day] of Object.entries(this.snapshot.supplyDays)) {
      if (day.supplyId === id) delete this.snapshot.supplyDays[key]
    }
    this.persist()
  }

  async listSupplyDays(from: ISODate, to: ISODate) {
    return Object.values(this.snapshot.supplyDays).filter((d) => d.date >= from && d.date <= to)
  }

  async saveSupplyDay(day: SupplyDay) {
    const key = entryKey(day.supplyId, day.date)
    if (day.received === 0 && day.used === 0 && day.counted === null) delete this.snapshot.supplyDays[key]
    else this.snapshot.supplyDays[key] = { ...day }
    this.persist()
  }

  async supplyStock() {
    const bySupply = new Map<string, SupplyDay[]>()
    for (const d of Object.values(this.snapshot.supplyDays)) {
      bySupply.set(d.supplyId, [...(bySupply.get(d.supplyId) ?? []), d])
    }
    const result: Record<string, SupplyStock> = {}
    for (const s of this.snapshot.supplies) result[s.id] = computeStock(bySupply.get(s.id) ?? [])
    return result
  }

  /** Wipes local data and reseeds the sample business. */
  reset() {
    this.snapshot = seed()
    this.persist()
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot))
    } catch {
      // Private mode or full storage: keep working in memory.
    }
  }
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  return i === -1 ? [...list, { ...item }] : list.map((x, j) => (j === i ? { ...item } : x))
}

function load(): Snapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? upgrade(JSON.parse(raw) as Partial<Snapshot> & Pick<Snapshot, 'groups' | 'products' | 'entries'>) : null
  } catch {
    return null
  }
}

/** Demo data saved by older versions: add units, wording and sample supplies. */
function upgrade(old: Partial<Snapshot> & Pick<Snapshot, 'groups' | 'products' | 'entries'>): Snapshot {
  const stock = old.supplies ? { supplies: old.supplies, supplyDays: old.supplyDays ?? {} } : seedSupplies()
  return {
    groups: old.groups,
    products: old.products.map((p) => ({ ...p, unit: p.unit ?? 'pcs' })),
    entries: old.entries,
    settings: old.settings ?? { entryLabels: 'made_thrown' },
    ...stock,
  }
}

// --- Sample data ---------------------------------------------------------

interface SeedProduct {
  name: string
  unit?: Unit
  /** Typical daily production. */
  base: number
  /** Typical share thrown away, 0..1. */
  waste: number
}

const SAMPLE: { group: string; products: SeedProduct[] }[] = [
  {
    group: 'Хляб',
    products: [
      { name: 'Бял хляб', base: 120, waste: 0.13 },
      { name: 'Пълнозърнест хляб', base: 40, waste: 0.08 },
      { name: 'Ръжен хляб', base: 25, waste: 0.18 },
    ],
  },
  {
    group: 'Баници',
    products: [
      { name: 'Баница със сирене', base: 80, waste: 0.22 },
      { name: 'Баница със спанак', base: 30, waste: 0.12 },
      { name: 'Тиквеник', base: 20, waste: 0.06 },
    ],
  },
  {
    group: 'Сладкиши',
    products: [
      { name: 'Кифли', base: 90, waste: 0.05 },
      { name: 'Кроасан', base: 60, waste: 0.16 },
      { name: 'Козунак', base: 15, waste: 0.25 },
    ],
  },
  {
    group: 'Кремове',
    products: [{ name: 'Шоколадов крем', unit: 'kg', base: 6, waste: 0.15 }],
  },
]

const SEED_DAYS = 21

function seed(): Snapshot {
  const random = mulberry32(42)
  const groups: ProductGroup[] = []
  const products: Product[] = []
  const entries: Record<string, DailyEntry> = {}
  const today = todayInSofia()

  SAMPLE.forEach((g, gi) => {
    const groupId = `group-${gi + 1}`
    groups.push({ id: groupId, name: g.group, sortOrder: gi + 1, archived: false })

    g.products.forEach((p, pi) => {
      const productId = `${groupId}-product-${pi + 1}`
      const unit = p.unit ?? 'pcs'
      products.push({ id: productId, groupId, name: p.name, unit, sortOrder: pi + 1, archived: false })

      // Past days only, so "Today" starts empty and ready to fill in.
      for (let d = SEED_DAYS; d >= 1; d--) {
        const date = addDays(today, -d)
        const round = (n: number) => (unit === 'pcs' ? Math.round(n) : Math.round(n * 10) / 10)
        const produced = round(p.base * (0.9 + random() * 0.2))
        const wasteShare = Math.max(0, p.waste * (0.5 + random()))
        const wasted = Math.min(produced, round(produced * wasteShare))
        entries[entryKey(productId, date)] = { productId, date, produced, wasted }
      }
    })
  })

  return { groups, products, entries, settings: { entryLabels: 'made_thrown' }, ...seedSupplies() }
}

interface SeedSupply {
  name: string
  unit: Unit
  lowStockAt: number
  /** Typical daily use. */
  daily: number
  /** Delivered every 7 days. */
  weekly: number
}

const SAMPLE_SUPPLIES: SeedSupply[] = [
  { name: 'Брашно', unit: 'kg', lowStockAt: 25, daily: 18, weekly: 125 },
  { name: 'Захар', unit: 'kg', lowStockAt: 10, daily: 4, weekly: 30 },
  { name: 'Масло', unit: 'kg', lowStockAt: 5, daily: 2.5, weekly: 15 },
  { name: 'Шоколад', unit: 'kg', lowStockAt: 3, daily: 1.2, weekly: 6 },
  { name: 'Прясно мляко', unit: 'l', lowStockAt: 10, daily: 8, weekly: 50 },
  { name: 'Яйца', unit: 'box', lowStockAt: 4, daily: 3, weekly: 20 },
]

/** Three weeks of deliveries and use, starting from a stock count. */
function seedSupplies(): Pick<Snapshot, 'supplies' | 'supplyDays'> {
  const random = mulberry32(7)
  const today = todayInSofia()
  const supplies: Supply[] = []
  const supplyDays: Record<string, SupplyDay> = {}

  SAMPLE_SUPPLIES.forEach((s, i) => {
    const supplyId = `supply-${i + 1}`
    supplies.push({ id: supplyId, name: s.name, unit: s.unit, lowStockAt: s.lowStockAt, sortOrder: i + 1, archived: false })
    const round = (n: number) => (s.unit === 'kg' || s.unit === 'l' ? Math.round(n * 10) / 10 : Math.round(n))
    for (let d = SEED_DAYS; d >= 1; d--) {
      const date = addDays(today, -d)
      const counted = d === SEED_DAYS ? round(s.weekly * 0.8) : null
      const received = d % 7 === 3 ? s.weekly : 0
      const used = round(s.daily * (0.8 + random() * 0.4))
      supplyDays[entryKey(supplyId, date)] = { supplyId, date, received, used, counted }
    }
  })

  return { supplies, supplyDays }
}

/** Small seeded PRNG so the sample data is the same on every device. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
