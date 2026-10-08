import type { ReactNode } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { wasteLevel } from '../lib/reports'

export function WastePill({ pct }: { pct: number | null }) {
  const { formatNumber } = useI18n()
  if (pct === null) return <span className="pill pill--none">–</span>
  return <span className={`pill pill--${wasteLevel(pct)}`}>{formatNumber(pct)}%</span>
}

interface PeriodNavProps {
  title: string
  subtitle?: string
  prevLabel: string
  nextLabel: string
  /** Omit to hide the back arrow (e.g. the Free plan's 7-day window). */
  onPrev?: () => void
  /** Omit to hide the forward arrow (e.g. you can't go past today). */
  onNext?: () => void
  extra?: ReactNode
}

/** Screen header with ‹ › arrows for moving between days or weeks. */
export function PeriodNav({ title, subtitle, prevLabel, nextLabel, onPrev, onNext, extra }: PeriodNavProps) {
  return (
    <header className="period">
      {onPrev ? (
        <button type="button" className="icon-btn" aria-label={prevLabel} onClick={onPrev}>
          ‹
        </button>
      ) : (
        <span className="icon-btn icon-btn--placeholder" aria-hidden="true" />
      )}
      <div className="period__text">
        {subtitle && <div className="period__subtitle">{subtitle}</div>}
        <h1 className="period__title">{title}</h1>
        {extra}
      </div>
      {onNext ? (
        <button type="button" className="icon-btn" aria-label={nextLabel} onClick={onNext}>
          ›
        </button>
      ) : (
        <span className="icon-btn icon-btn--placeholder" aria-hidden="true" />
      )}
    </header>
  )
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__hint">{hint}</p>
    </div>
  )
}
