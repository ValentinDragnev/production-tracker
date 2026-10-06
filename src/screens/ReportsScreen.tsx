import { useEffect, useState, type ReactNode } from 'react'
import { EmptyState, PeriodNav, WastePill } from '../components/common'
import { useStore } from '../data/StoreProvider'
import type { DailyEntry, ISODate } from '../data/types'
import { useI18n } from '../i18n/I18nProvider'
import { addDays, formatDate, startOfWeek, todayInSofia, weekDates } from '../lib/dates'
import {
  dailyTotals,
  groupReport,
  suggestions,
  totals,
  wasteLevel,
  type GroupSection,
  type Totals,
} from '../lib/reports'

type Mode = 'day' | 'week'

const MAX_TIPS = 3

export function ReportsScreen() {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('week')

  return (
    <div className="screen">
      <div className="segmented" role="tablist">
        {(['day', 'week'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'is-active' : ''}
            onClick={() => setMode(m)}
          >
            {t(m)}
          </button>
        ))}
      </div>
      {mode === 'day' ? <DayReport /> : <WeekReport />}
    </div>
  )
}

function useEntries(from: ISODate, to: ISODate): DailyEntry[] | null {
  const { store } = useStore()
  const [loaded, setLoaded] = useState<{ key: string; entries: DailyEntry[] } | null>(null)
  const key = `${from}|${to}`

  useEffect(() => {
    let cancelled = false
    void store.listEntries(from, to).then((entries) => {
      if (!cancelled) setLoaded({ key: `${from}|${to}`, entries })
    })
    return () => {
      cancelled = true
    }
  }, [store, from, to])

  return loaded?.key === key ? loaded.entries : null
}

function DayReport() {
  const { t, locale } = useI18n()
  const { groups, products } = useStore()
  const today = todayInSofia()
  // Default to yesterday: today is usually still being filled in.
  const [date, setDate] = useState<ISODate>(addDays(today, -1))
  const entries = useEntries(date, date)

  return (
    <>
      <PeriodNav
        title={formatDate(date, locale, { weekday: 'long' })}
        subtitle={formatDate(date, locale, { day: 'numeric', month: 'long', year: 'numeric' })}
        prevLabel={t('previousDay')}
        nextLabel={t('nextDay')}
        onPrev={() => setDate(addDays(date, -1))}
        onNext={date < today ? () => setDate(addDays(date, 1)) : undefined}
      />
      {entries && <ReportBody sections={groupReport(groups, products, entries)} summary={totals(entries)} />}
    </>
  )
}

function WeekReport() {
  const { t, locale, formatNumber } = useI18n()
  const { groups, products } = useStore()
  const today = todayInSofia()
  const thisMonday = startOfWeek(today)
  // Default to last week when it's early in the week and there's little data yet.
  const [monday, setMonday] = useState<ISODate>(() =>
    today < addDays(thisMonday, 3) ? addDays(thisMonday, -7) : thisMonday,
  )
  const dates = weekDates(monday)
  const entries = useEntries(dates[0], dates[6])
  const sunday = dates[6]
  const sameMonth = monday.slice(5, 7) === sunday.slice(5, 7)

  const range = `${formatDate(monday, locale, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} – ${formatDate(
    sunday,
    locale,
    { day: 'numeric', month: 'long' },
  )}`

  const sections = entries ? groupReport(groups, products, entries) : []
  // Only the worst few, so the advice stays readable.
  const tips = suggestions(sections).slice(0, MAX_TIPS)

  return (
    <>
      <PeriodNav
        title={
          monday === thisMonday ? t('thisWeek') : monday === addDays(thisMonday, -7) ? t('lastWeek') : t('week')
        }
        subtitle={range}
        prevLabel={t('previousWeek')}
        nextLabel={t('nextWeek')}
        onPrev={() => setMonday(addDays(monday, -7))}
        onNext={monday < thisMonday ? () => setMonday(addDays(monday, 7)) : undefined}
      />
      {entries && (
        <ReportBody
          sections={sections}
          summary={totals(entries)}
          chart={<WeekChart days={dailyTotals(dates, entries)} />}
          tips={tips.map((s) => (
            <div key={s.product.id} className="tip">
              <div className="tip__title">💡 {t('tip')}</div>
              <p className="tip__text">
                {t('suggestion', {
                  name: s.product.name,
                  produced: s.avgProduced,
                  wasted: s.avgWasted,
                  suggested: formatNumber(s.suggested),
                })}
              </p>
            </div>
          ))}
        />
      )}
    </>
  )
}

interface ReportBodyProps {
  sections: GroupSection[]
  summary: Totals
  chart?: ReactNode
  tips?: ReactNode[]
}

function ReportBody({ sections, summary, chart, tips }: ReportBodyProps) {
  const { t, formatNumber } = useI18n()

  if (sections.length === 0) return <EmptyState title={t('noData')} hint={t('noDataHint')} />

  return (
    <>
      <div className="card summary">
        <div>
          <div className="summary__label">{t('wasted')}</div>
          <div className={`summary__pct summary__pct--${wasteLevel(summary.wastePct)}`}>
            {summary.wastePct === null ? '–' : `${formatNumber(summary.wastePct)}%`}
          </div>
          <div className="summary__detail">
            {t('wasteOf', { wasted: summary.wasted, produced: summary.produced })}
          </div>
        </div>
        {chart}
      </div>

      {tips && tips.length > 0 && <div className="tips">{tips}</div>}

      {sections.map((section) => (
        <section key={section.group.id} className="group">
          <h2 className="group__title group__title--with-pill">
            <span>{section.group.name}</span>
            <WastePill pct={section.totals.wastePct} />
          </h2>
          <div className="card card--list">
            {section.rows.map((row) => (
              <div key={row.product.id} className="row">
                <div>
                  <div className="row__name">{row.product.name}</div>
                  <div className="row__detail">
                    {t('wasteOf', { wasted: row.totals.wasted, produced: row.totals.produced })}
                  </div>
                </div>
                <WastePill pct={row.totals.wastePct} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function WeekChart({ days }: { days: ReturnType<typeof dailyTotals> }) {
  const { locale, formatNumber } = useI18n()
  const max = Math.max(20, ...days.map((d) => d.totals.wastePct ?? 0))

  return (
    <div className="week-chart" aria-hidden="true">
      {days.map(({ date, totals: day }) => (
        <div key={date} className="week-chart__col" title={day.wastePct === null ? '' : `${formatNumber(day.wastePct)}%`}>
          <div className="week-chart__track">
            {day.wastePct !== null && (
              <div
                className={`week-chart__bar week-chart__bar--${wasteLevel(day.wastePct)}`}
                style={{ height: `${Math.max(6, (day.wastePct / max) * 100)}%` }}
              />
            )}
          </div>
          <div className="week-chart__label">{formatDate(date, locale, { weekday: 'narrow' })}</div>
        </div>
      ))}
    </div>
  )
}
