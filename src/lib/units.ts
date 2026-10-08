export type Unit = 'pcs' | 'kg' | 'bag' | 'box' | 'l'

/** Display order everywhere (pickers, report lines). */
export const UNITS: Unit[] = ['pcs', 'kg', 'l', 'bag', 'box']

export const MAX_QUANTITY = 99999

/** kg and litres can be weighed out in parts; the rest are counted. */
export function allowsDecimals(unit: Unit): boolean {
  return unit === 'kg' || unit === 'l'
}

export function roundQuantity(n: number, unit: Unit): number {
  const clamped = Math.min(MAX_QUANTITY, Math.max(0, n))
  return allowsDecimals(unit) ? Math.round(clamped * 100) / 100 : Math.round(clamped)
}

/**
 * Reads what someone typed: "2,5" or "2.5" for kg/l, digits only otherwise.
 * Empty or unreadable input counts as 0.
 */
export function parseQuantity(raw: string, unit: Unit): number {
  const n = Number(cleanQuantityInput(raw, unit).replace(',', '.'))
  return Number.isFinite(n) ? roundQuantity(n, unit) : 0
}

/** Keeps only what's valid while typing, e.g. "2," stays so "2,5" can follow. */
export function cleanQuantityInput(raw: string, unit: Unit): string {
  if (!allowsDecimals(unit)) return raw.replace(/\D/g, '')
  const kept = raw.replace(/[^\d.,]/g, '')
  const sep = kept.search(/[.,]/)
  if (sep === -1) return kept
  // One separator, at most two decimals.
  return kept.slice(0, sep + 1) + kept.slice(sep + 1).replace(/[.,]/g, '').slice(0, 2)
}

export function formatQuantity(n: number, unit: Unit, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: allowsDecimals(unit) ? 2 : 0,
    useGrouping: false,
  }).format(n)
}
