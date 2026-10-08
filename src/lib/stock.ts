import type { SupplyDay, SupplyStock } from '../data/types'

/**
 * Stock for one supply from its daily rows: the latest count, plus what was
 * received and minus what was used on later days. Mirrors the database's
 * supply_stock(); used by the demo store.
 */
export function computeStock(days: SupplyDay[]): SupplyStock {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  let lastCount: SupplyDay | undefined
  for (const d of sorted) if (d.counted !== null) lastCount = d
  let stock = lastCount?.counted ?? 0
  for (const d of sorted) {
    if (!lastCount || d.date > lastCount.date) stock += d.received - d.used
  }
  return { stock: Math.round(stock * 100) / 100, countedOn: lastCount?.date ?? null }
}

export type StockLevel = 'ok' | 'low' | 'out'

export function stockLevel(stock: number, lowStockAt: number | null): StockLevel {
  if (stock <= 0) return 'out'
  if (lowStockAt !== null && stock <= lowStockAt) return 'low'
  return 'ok'
}
