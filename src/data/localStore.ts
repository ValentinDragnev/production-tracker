import { addDays, todayInSofia } from '../lib/dates'
import type { DailyEntry, DataStore, ISODate, Product, ProductGroup } from './types'

const STORAGE_KEY = 'production-tracker:demo:v1'

interface Snapshot {
  groups: ProductGroup[]
  products: Product[]
  entries: Record<string, DailyEntry>
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
    return raw ? (JSON.parse(raw) as Snapshot) : null
  } catch {
    return null
  }
}

// --- Sample data ---------------------------------------------------------

interface SeedProduct {
  name: string
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
      products.push({ id: productId, groupId, name: p.name, sortOrder: pi + 1, archived: false })

      // Past days only, so "Today" starts empty and ready to fill in.
      for (let d = SEED_DAYS; d >= 1; d--) {
        const date = addDays(today, -d)
        const produced = Math.round(p.base * (0.9 + random() * 0.2))
        const wasteShare = Math.max(0, p.waste * (0.5 + random()))
        const wasted = Math.min(produced, Math.round(produced * wasteShare))
        entries[entryKey(productId, date)] = { productId, date, produced, wasted }
      }
    })
  })

  return { groups, products, entries }
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
