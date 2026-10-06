import { describe, expect, it } from 'vitest'
import type { DailyEntry, Product, ProductGroup } from '../data/types'
import { groupReport, suggestions, totals, wasteLevel } from './reports'

const groups: ProductGroup[] = [
  { id: 'g2', name: 'Баници', sortOrder: 2, archived: false },
  { id: 'g1', name: 'Хляб', sortOrder: 1, archived: false },
]
const products: Product[] = [
  { id: 'bread', groupId: 'g1', name: 'Бял хляб', sortOrder: 1, archived: false },
  { id: 'rye', groupId: 'g1', name: 'Ръжен хляб', sortOrder: 2, archived: false },
  { id: 'banitsa', groupId: 'g2', name: 'Баница', sortOrder: 1, archived: false },
]

const entry = (productId: string, date: string, produced: number, wasted: number): DailyEntry => ({
  productId,
  date,
  produced,
  wasted,
})

describe('totals', () => {
  it('sums and computes waste %', () => {
    const t = totals([entry('bread', '2026-10-05', 100, 10), entry('bread', '2026-10-06', 100, 30)])
    expect(t).toEqual({ produced: 200, wasted: 40, wastePct: 20 })
  })

  it('has no waste % when nothing was produced', () => {
    expect(totals([]).wastePct).toBeNull()
  })
})

describe('wasteLevel', () => {
  it('splits at 10% and 20%', () => {
    expect(wasteLevel(null)).toBe('low')
    expect(wasteLevel(9.9)).toBe('low')
    expect(wasteLevel(10)).toBe('medium')
    expect(wasteLevel(19.9)).toBe('medium')
    expect(wasteLevel(20)).toBe('high')
  })
})

describe('groupReport', () => {
  it('orders groups and skips products and groups without data', () => {
    const report = groupReport(groups, products, [
      entry('banitsa', '2026-10-05', 80, 16),
      entry('bread', '2026-10-05', 120, 12),
      entry('rye', '2026-10-05', 0, 0),
    ])
    expect(report.map((s) => s.group.id)).toEqual(['g1', 'g2'])
    expect(report[0].rows.map((r) => r.product.id)).toEqual(['bread'])
    expect(report[0].totals).toEqual({ produced: 120, wasted: 12, wastePct: 10 })
  })
})

describe('suggestions', () => {
  const week = (productId: string, produced: number, wasted: number, days = 5) =>
    Array.from({ length: days }, (_, i) => entry(productId, `2026-10-0${i + 1}`, produced, wasted))

  it('suggests average produced minus average wasted, rounded to 5', () => {
    const report = groupReport(groups, products, [...week('banitsa', 80, 18), ...week('bread', 120, 5)])
    expect(suggestions(report)).toEqual([
      { product: products[2], avgProduced: 80, avgWasted: 18, suggested: 60 },
    ])
  })

  it('needs at least 3 days of data', () => {
    const report = groupReport(groups, products, week('banitsa', 80, 30, 2))
    expect(suggestions(report)).toEqual([])
  })

  it('puts the worst waste first', () => {
    const report = groupReport(groups, products, [...week('bread', 100, 12), ...week('banitsa', 80, 30)])
    expect(suggestions(report).map((s) => s.product.id)).toEqual(['banitsa', 'bread'])
  })
})
