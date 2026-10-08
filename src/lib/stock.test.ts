import { describe, expect, it } from 'vitest'
import type { SupplyDay } from '../data/types'
import { computeStock, stockLevel } from './stock'

const day = (date: string, received: number, used: number, counted: number | null = null): SupplyDay => ({
  supplyId: 'flour',
  date,
  received,
  used,
  counted,
})

describe('computeStock', () => {
  it('starts from zero without a count', () => {
    expect(computeStock([day('2026-10-01', 5, 2)])).toEqual({ stock: 3, countedOn: null })
  })

  it('builds on the latest count, matching the database', () => {
    const days = [
      day('2026-10-01', 25, 0),
      day('2026-10-02', 0, 3, 20),
      day('2026-10-03', 0, 5.5),
      day('2026-10-04', 10, 0),
    ]
    expect(computeStock(days)).toEqual({ stock: 24.5, countedOn: '2026-10-02' })
  })

  it('ignores the order rows come in', () => {
    expect(computeStock([day('2026-10-03', 0, 1), day('2026-10-02', 0, 0, 10)])).toEqual({ stock: 9, countedOn: '2026-10-02' })
  })
})

describe('stockLevel', () => {
  it('warns at or below the threshold and when empty', () => {
    expect(stockLevel(12, 10)).toBe('ok')
    expect(stockLevel(10, 10)).toBe('low')
    expect(stockLevel(0, 10)).toBe('out')
    expect(stockLevel(-2, null)).toBe('out')
    expect(stockLevel(1, null)).toBe('ok')
  })
})
