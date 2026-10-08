import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState, PeriodNav } from '../components/common'
import { entryLabelKeys } from '../components/labels'
import { Stepper } from '../components/Stepper'
import { SubscriptionNotice } from '../components/Subscription'
import { useStore } from '../data/StoreProvider'
import type { DailyEntry, ISODate } from '../data/types'
import { useI18n } from '../i18n/I18nProvider'
import { addDays, formatDate, todayInSofia } from '../lib/dates'
import { FREE_HISTORY_DAYS } from '../lib/subscription'
import { sortByOrder } from '../lib/reports'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type Counts = Pick<DailyEntry, 'produced' | 'wasted'>

const SAVE_DELAY_MS = 500
const EMPTY: Counts = { produced: 0, wasted: 0 }

export function TodayScreen({ onHowToPay }: { onHowToPay(): void }) {
  const { t, locale } = useI18n()
  const { store, groups, products, role, canEdit, recheckAccess, settings, limits, inPlan } = useStore()
  const labels = entryLabelKeys(settings.entryLabels)
  const today = todayInSofia()
  const [date, setDate] = useState<ISODate>(today)
  // Tagged with its date so we never show (or edit) one day's numbers under another.
  const [loaded, setLoaded] = useState<{ date: ISODate; counts: Record<string, Counts> } | null>(null)
  const counts = loaded?.date === date ? loaded.counts : null
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [cappedId, setCappedId] = useState<string | null>(null)

  const pending = useRef(new Map<string, { entry: DailyEntry; timer: number }>())
  const cappedTimer = useRef<number | undefined>(undefined)

  const save = useCallback(
    async (entry: DailyEntry) => {
      pending.current.delete(entry.productId)
      setStatus('saving')
      try {
        await store.saveEntry(entry)
        if (pending.current.size === 0) setStatus('saved')
      } catch {
        setStatus('error')
        // Maybe the subscription just ended: re-check so the screen says so.
        recheckAccess()
      }
    },
    [store, recheckAccess],
  )

  // Save anything still waiting before switching day or leaving the screen.
  const flush = useCallback(() => {
    for (const { entry, timer } of pending.current.values()) {
      window.clearTimeout(timer)
      void save(entry)
    }
  }, [save])

  useEffect(() => {
    let cancelled = false
    void store.listEntries(date, date).then((entries) => {
      if (cancelled) return
      setLoaded({
        date,
        counts: Object.fromEntries(entries.map((e) => [e.productId, { produced: e.produced, wasted: e.wasted }])),
      })
    })
    return () => {
      cancelled = true
      flush()
    }
  }, [store, date, flush])

  const update = (productId: string, field: keyof Counts, value: number) => {
    if (!counts) return
    const current = counts[productId] ?? EMPTY
    const next = { ...current, [field]: value }
    if (next.wasted > next.produced) {
      next.wasted = next.produced
      setCappedId(productId)
      window.clearTimeout(cappedTimer.current)
      cappedTimer.current = window.setTimeout(() => setCappedId(null), 3000)
    }
    setLoaded({ date, counts: { ...counts, [productId]: next } })

    const entry: DailyEntry = { productId, date, ...next }
    const existing = pending.current.get(productId)
    if (existing) window.clearTimeout(existing.timer)
    const timer = window.setTimeout(() => void save(entry), SAVE_DELAY_MS)
    pending.current.set(productId, { entry, timer })
    setStatus('saving')
  }

  const isToday = date === today
  // The Free plan sees and edits only today and the 6 days before.
  const earliest = limits.fullHistory ? null : addDays(today, -(FREE_HISTORY_DAYS - 1))
  const activeCount = products.filter((p) => !p.archived).length
  const overLimit = limits.products !== null && activeCount > limits.products
  const visibleGroups = sortByOrder(groups.filter((g) => !g.archived))
    .map((group) => ({
      group,
      products: sortByOrder(products.filter((p) => p.groupId === group.id && !p.archived)),
    }))
    .filter((g) => g.products.length > 0)

  return (
    <div className="screen">
      <PeriodNav
        title={isToday ? t('today') : formatDate(date, locale, { weekday: 'short', day: 'numeric', month: 'short' })}
        subtitle={formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        prevLabel={t('previousDay')}
        nextLabel={t('nextDay')}
        onPrev={earliest && date <= earliest ? undefined : () => setDate(addDays(date, -1))}
        onNext={isToday ? undefined : () => setDate(addDays(date, 1))}
        extra={
          !isToday && (
            <button type="button" className="link-btn" onClick={() => setDate(today)}>
              {t('goToToday')}
            </button>
          )
        }
      />

      <SubscriptionNotice onHowToPay={onHowToPay} />
      {role === 'owner' && overLimit && (
        <div className="reminder" role="status">
          <span>{t('overProductLimit', { count: activeCount, limit: limits.products! })}</span>
        </div>
      )}

      <div className={`save-status save-status--${status}`} role="status">
        {status === 'saving' && t('saving')}
        {status === 'saved' && `✓ ${t('saved')}`}
        {status === 'error' && t('saveFailed')}
      </div>

      {counts && visibleGroups.length === 0 && (
        <EmptyState title={t('noProducts')} hint={t(role === 'owner' ? 'noProductsHint' : 'noProductsStaffHint')} />
      )}

      {counts &&
        visibleGroups.map(({ group, products: groupProducts }) => (
        <section key={group.id} className="group">
          <h2 className="group__title">{group.name}</h2>
          {groupProducts.map((product) => {
            const c = counts[product.id] ?? EMPTY
            return (
              <div key={product.id} className={inPlan.has(product.id) ? 'card' : 'card card--outside'}>
                <div className="card__title">{product.name}</div>
                <Stepper
                  label={t(labels.produced)}
                  productName={product.name}
                  unit={product.unit}
                  tone="produced"
                  disabled={!canEdit || !inPlan.has(product.id)}
                  value={c.produced}
                  onChange={(v) => update(product.id, 'produced', v)}
                />
                <Stepper
                  label={t(labels.wasted)}
                  productName={product.name}
                  unit={product.unit}
                  tone="wasted"
                  disabled={!canEdit || !inPlan.has(product.id)}
                  value={c.wasted}
                  onChange={(v) => update(product.id, 'wasted', v)}
                />
                {cappedId === product.id && <p className="card__hint">{t('wastedTooHigh')}</p>}
                {!inPlan.has(product.id) && <p className="card__note">{t('notInPlan')}</p>}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
