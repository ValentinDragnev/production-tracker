import { useEffect, useState, type ReactNode } from 'react'
import { EmptyState, PeriodNav, WastePill } from '../components/common'
import { PlanUpsell } from '../components/Subscription'
import { entryLabelKeys, UNIT_SHORT } from '../components/labels'
import { useStore } from '../data/StoreProvider'
import type { DailyEntry, ISODate } from '../data/types'
import { useI18n } from '../i18n/I18nProvider'
import { addDays, addMonths, formatDate, monthDates, startOfMonth, startOfWeek, todayInSofia, weekDates } from '../lib/dates'
import {
  dailyTotals,
  groupReport,
  suggestions,
  totals,
  totalsByUnit,
  wasteLevel,
  type GroupSection,
  type Totals,
  type UnitTotals,
} from '../lib/reports'
import { FREE_HISTORY_DAYS } from '../lib/subscription'
import { formatQuantity, type Unit } from '../lib/units'

type Mode = 'day' | 'week' | 'month'

const MAX_TIPS = 3

export function ReportsScreen() {
  const { t } = useI18n()
  const { limits } = useStore()
  const [mode, setMode] = useState<Mode>('week')

  return (
    <div className="screen">
      <div className="segmented" role="tablist">
        {(['day', 'week', 'month'] as const).map((m) => (
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
      {!limits.fullHistory && mode !== 'month' && <p className="muted report__limit">{t('historyLimit')}</p>}
      {mode === 'day' && <DayReport />}
      {mode === 'week' && <WeekReport />}
      {mode === 'month' &&
        (limits.fullHistory ? (
          <MonthReport />
        ) : (
          <div className="report__upsell">
            <PlanUpsell title="monthUpsell" body="historyLimit" />
          </div>
        ))}
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

/** First date the plan can show; null when all history is available. */
function useEarliestDate(): ISODate | null {
  const { limits } = useStore()
  return limits.fullHistory ? null : addDays(todayInSofia(), -(FREE_HISTORY_DAYS - 1))
}

function DayReport() {
  const { t, locale } = useI18n()
  const { groups, products } = useStore()
  const today = todayInSofia()
  const earliest = useEarliestDate()
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
        onPrev={earliest && date <= earliest ? undefined : () => setDate(addDays(date, -1))}
        onNext={date < today ? () => setDate(addDays(date, 1)) : undefined}
      />
      {entries && <ReportBody sections={groupReport(groups, products, entries)} summary={totalsByUnit(entries, products)} />}
    </>
  )
}

function WeekReport() {
  const { t, locale } = useI18n()
  const today = todayInSofia()
  const thisMonday = startOfWeek(today)
  const earliest = useEarliestDate()
  // Default to last week when it's early in the week and there's little data yet.
  const [monday, setMonday] = useState<ISODate>(() =>
    today < addDays(thisMonday, 3) && !earliest ? addDays(thisMonday, -7) : thisMonday,
  )
  const dates = weekDates(monday)
  const sunday = dates[6]
  const sameMonth = monday.slice(5, 7) === sunday.slice(5, 7)

  const range = `${formatDate(monday, locale, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} – ${formatDate(
    sunday,
    locale,
    { day: 'numeric', month: 'long' },
  )}`

  return (
    <>
      <PeriodNav
        title={
          monday === thisMonday ? t('thisWeek') : monday === addDays(thisMonday, -7) ? t('lastWeek') : t('week')
        }
        subtitle={range}
        prevLabel={t('previousWeek')}
        nextLabel={t('nextWeek')}
        onPrev={earliest && monday <= earliest ? undefined : () => setMonday(addDays(monday, -7))}
        onNext={monday < thisMonday ? () => setMonday(addDays(monday, 7)) : undefined}
      />
      <PeriodReport
        dates={dates}
        bars={(entries) =>
          dailyTotals(dates, entries).map((d) => ({
            key: d.date,
            label: formatDate(d.date, locale, { weekday: 'narrow' }),
            totals: d.totals,
          }))
        }
      />
    </>
  )
}

function MonthReport() {
  const { t, locale } = useI18n()
  const today = todayInSofia()
  const thisMonth = startOfMonth(today)
  // In the first days of a month, last month is the useful one.
  const [month, setMonth] = useState<ISODate>(() => (Number(today.slice(8)) < 4 ? addMonths(thisMonth, -1) : thisMonth))
  const dates = monthDates(month)

  // One bar per Monday–Sunday week, cut to the month: "1–4", "5–11", ...
  const weeks = dates.reduce<ISODate[][]>((acc, d) => {
    if (acc.length === 0 || startOfWeek(d) === d) acc.push([])
    acc[acc.length - 1].push(d)
    return acc
  }, [])

  return (
    <>
      <PeriodNav
        title={month === thisMonth ? t('thisMonth') : month === addMonths(thisMonth, -1) ? t('lastMonth') : t('month')}
        subtitle={formatDate(month, locale, { month: 'long', year: 'numeric' })}
        prevLabel={t('previousMonth')}
        nextLabel={t('nextMonth')}
        onPrev={() => setMonth(addMonths(month, -1))}
        onNext={month < thisMonth ? () => setMonth(addMonths(month, 1)) : undefined}
      />
      <PeriodReport
        dates={dates}
        bars={(entries) =>
          weeks.map((w) => ({
            key: w[0],
            label: `${Number(w[0].slice(8))}–${Number(w[w.length - 1].slice(8))}`,
            totals: totals(entries.filter((e) => e.date >= w[0] && e.date <= w[w.length - 1])),
          }))
        }
      />
    </>
  )
}

interface Bar {
  key: string
  label: string
  totals: Totals
}

/** Totals, chart and tips for a run of days (a week or a month). */
function PeriodReport({ dates, bars }: { dates: ISODate[]; bars(entries: DailyEntry[]): Bar[] }) {
  const { t, locale } = useI18n()
  const { groups, products, settings } = useStore()
  const labels = entryLabelKeys(settings.entryLabels)
  const entries = useEntries(dates[0], dates[dates.length - 1])
  if (!entries) return null

  const sections = groupReport(groups, products, entries)
  // Only the worst few, so the advice stays readable.
  const tips = suggestions(sections).slice(0, MAX_TIPS)
  const summary = totalsByUnit(entries, products)
  // The chart can't mix units either: it follows the first (main) unit.
  const chartUnit = summary[0]?.unit ?? 'pcs'
  const chartEntries = entries.filter((e) => (products.find((p) => p.id === e.productId)?.unit ?? 'pcs') === chartUnit)

  return (
    <ReportBody
      sections={sections}
      summary={summary}
      chart={<BarChart bars={bars(chartEntries)} unit={summary.length > 1 ? chartUnit : null} />}
      tips={tips.map((s) => {
        const q = (n: number) => formatQuantity(n, s.product.unit, locale)
        return (
          <div key={s.product.id} className="tip">
            <div className="tip__title">💡 {t('tip')}</div>
            <p className="tip__text">
              {t(labels.wasted === 'returned' ? 'suggestionSent' : 'suggestion', {
                name: s.product.name,
                produced: q(s.avgProduced),
                wasted: q(s.avgWasted),
                suggested: q(s.suggested),
                unit: t(UNIT_SHORT[s.product.unit]),
              })}
            </p>
          </div>
        )
      })}
    />
  )
}

interface ReportBodyProps {
  sections: GroupSection[]
  /** One entry per unit; kilograms and pieces are never added together. */
  summary: UnitTotals[]
  chart?: ReactNode
  tips?: ReactNode[]
}

function ReportBody({ sections, summary, chart, tips }: ReportBodyProps) {
  const { t, formatNumber, locale } = useI18n()
  const { settings } = useStore()
  const labels = entryLabelKeys(settings.entryLabels)
  const amounts = (u: UnitTotals) =>
    t('wasteOf', {
      wasted: formatQuantity(u.totals.wasted, u.unit, locale),
      produced: formatQuantity(u.totals.produced, u.unit, locale),
      unit: t(UNIT_SHORT[u.unit]),
    })
  const pct = (p: number | null) => (p === null ? '–' : `${formatNumber(p)}%`)

  if (sections.length === 0) return <EmptyState title={t('noData')} hint={t('noDataHint')} />

  return (
    <>
      <div className="card summary">
        <div>
          <div className="summary__label">{t(labels.wasted)}</div>
          {summary.length === 1 ? (
            <>
              <div className={`summary__pct summary__pct--${wasteLevel(summary[0].totals.wastePct)}`}>
                {pct(summary[0].totals.wastePct)}
              </div>
              <div className="summary__detail">{amounts(summary[0])}</div>
            </>
          ) : (
            summary.map((u) => (
              <div key={u.unit} className="summary__unit">
                <span className={`summary__unit-pct summary__pct--${wasteLevel(u.totals.wastePct)}`}>
                  {pct(u.totals.wastePct)}
                </span>
                <span className="summary__detail">{amounts(u)}</span>
              </div>
            ))
          )}
        </div>
        {chart}
      </div>

      {tips && tips.length > 0 && <div className="tips">{tips}</div>}

      {sections.map((section) => (
        <section key={section.group.id} className="group">
          <h2 className="group__title group__title--with-pill">
            <span>{section.group.name}</span>
            {/* Only when the group uses one unit: no % of kg-plus-pieces. */}
            {section.byUnit.length === 1 && <WastePill pct={section.byUnit[0].totals.wastePct} />}
          </h2>
          <div className="card card--list">
            {section.rows.map((row) => (
              <div key={row.product.id} className="row">
                <div>
                  <div className="row__name">{row.product.name}</div>
                  <div className="row__detail">{amounts({ unit: row.product.unit, totals: row.totals })}</div>
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

/** Waste % per bar (day or week); `unit` is shown when the period mixes units. */
function BarChart({ bars, unit }: { bars: Bar[]; unit: Unit | null }) {
  const { t, formatNumber } = useI18n()
  const max = Math.max(20, ...bars.map((b) => b.totals.wastePct ?? 0))

  return (
    <div className="week-chart" aria-hidden="true" data-unit={unit ? t(UNIT_SHORT[unit]) : undefined}>
      {bars.map(({ key, label, totals: bar }) => (
        <div key={key} className="week-chart__col" title={bar.wastePct === null ? '' : `${formatNumber(bar.wastePct)}%`}>
          <div className="week-chart__track">
            {bar.wastePct !== null && (
              <div
                className={`week-chart__bar week-chart__bar--${wasteLevel(bar.wastePct)}`}
                style={{ height: `${Math.max(6, (bar.wastePct / max) * 100)}%` }}
              />
            )}
          </div>
          <div className="week-chart__label">{label}</div>
        </div>
      ))}
    </div>
  )
}
