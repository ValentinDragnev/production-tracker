import type { DailyEntry, ISODate, Product, ProductGroup } from '../data/types'

export interface Totals {
  produced: number
  wasted: number
  /** wasted / produced as 0..100, or null when nothing was produced. */
  wastePct: number | null
}

export type WasteLevel = 'low' | 'medium' | 'high'

/** Waste % thresholds for the green / amber / red markers. */
export const WASTE_MEDIUM = 10
export const WASTE_HIGH = 20

export function totals(entries: DailyEntry[]): Totals {
  let produced = 0
  let wasted = 0
  for (const e of entries) {
    produced += e.produced
    wasted += e.wasted
  }
  return { produced, wasted, wastePct: produced > 0 ? (wasted / produced) * 100 : null }
}

export function wasteLevel(pct: number | null): WasteLevel {
  if (pct === null || pct < WASTE_MEDIUM) return 'low'
  return pct < WASTE_HIGH ? 'medium' : 'high'
}

export interface ProductRow {
  product: Product
  totals: Totals
  /** Days in the range that have a non-zero entry for this product. */
  daysWithData: number
}

export interface GroupSection {
  group: ProductGroup
  totals: Totals
  rows: ProductRow[]
}

/**
 * Totals per group and product, in display order. Products with no data in
 * the range are left out, and so are groups that end up empty.
 */
export function groupReport(
  groups: ProductGroup[],
  products: Product[],
  entries: DailyEntry[],
): GroupSection[] {
  const byProduct = new Map<string, DailyEntry[]>()
  for (const e of entries) {
    if (e.produced === 0 && e.wasted === 0) continue
    const list = byProduct.get(e.productId) ?? []
    list.push(e)
    byProduct.set(e.productId, list)
  }

  return sortByOrder(groups)
    .map((group) => {
      const rows = sortByOrder(products.filter((p) => p.groupId === group.id))
        .filter((p) => byProduct.has(p.id))
        .map((product) => {
          const list = byProduct.get(product.id)!
          return { product, totals: totals(list), daysWithData: list.length }
        })
      const groupEntries = rows.flatMap((r) => byProduct.get(r.product.id)!)
      return { group, totals: totals(groupEntries), rows }
    })
    .filter((section) => section.rows.length > 0)
}

export interface DayTotals {
  date: ISODate
  totals: Totals
}

export function dailyTotals(dates: ISODate[], entries: DailyEntry[]): DayTotals[] {
  return dates.map((date) => ({ date, totals: totals(entries.filter((e) => e.date === date)) }))
}

export interface Suggestion {
  product: Product
  avgProduced: number
  avgWasted: number
  suggested: number
}

/** Minimum days of data in a week before we suggest anything. */
export const SUGGESTION_MIN_DAYS = 3

/**
 * For products that waste a lot, suggest making roughly what was actually
 * used: average produced minus average wasted, rounded to the nearest 5.
 * Worst offenders first.
 */
export function suggestions(sections: GroupSection[]): Suggestion[] {
  return sections
    .flatMap((s) => s.rows)
    .filter((r) => r.daysWithData >= SUGGESTION_MIN_DAYS && wasteLevel(r.totals.wastePct) !== 'low')
    .sort((a, b) => (b.totals.wastePct ?? 0) - (a.totals.wastePct ?? 0))
    .map((r) => {
      const avgProduced = r.totals.produced / r.daysWithData
      const avgWasted = r.totals.wasted / r.daysWithData
      const suggested = Math.max(5, Math.round((avgProduced - avgWasted) / 5) * 5)
      return {
        product: r.product,
        avgProduced: Math.round(avgProduced),
        avgWasted: Math.round(avgWasted),
        suggested,
      }
    })
    .filter((s) => s.suggested < s.avgProduced)
}

export function sortByOrder<T extends { sortOrder: number; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}
