import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState, PeriodNav } from '../components/common'
import { UNIT_SHORT } from '../components/labels'
import { Stepper } from '../components/Stepper'
import { SubscriptionNotice } from '../components/Subscription'
import { useStore } from '../data/StoreProvider'
import type { ISODate, Supply, SupplyDay, SupplyStock } from '../data/types'
import { useI18n } from '../i18n/I18nProvider'
import { addDays, formatDate, todayInSofia } from '../lib/dates'
import { sortByOrder } from '../lib/reports'
import { stockLevel } from '../lib/stock'
import { allowsDecimals, cleanQuantityInput, formatQuantity, parseQuantity } from '../lib/units'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
const SAVE_DELAY_MS = 500

const emptyDay = (supplyId: string, date: ISODate): SupplyDay => ({ supplyId, date, received: 0, used: 0, counted: null })

/** Supplies: what came in and what was used on a day, and what's left. */
export function StockScreen({ onHowToPay }: { onHowToPay(): void }) {
  const { t, locale } = useI18n()
  const { store, supplies, role, canEdit, recheckAccess } = useStore()
  const today = todayInSofia()
  const [date, setDate] = useState<ISODate>(today)
  const [loaded, setLoaded] = useState<{ date: ISODate; days: Record<string, SupplyDay> } | null>(null)
  const [stock, setStock] = useState<Record<string, SupplyStock>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const days = loaded?.date === date ? loaded.days : null
  const pending = useRef(new Map<string, { day: SupplyDay; timer: number }>())

  const loadStock = useCallback(async () => {
    try {
      setStock(await store.supplyStock())
    } catch {
      // Keep the last known stock; the numbers below still save.
    }
  }, [store])

  const save = useCallback(
    async (day: SupplyDay) => {
      pending.current.delete(day.supplyId)
      setStatus('saving')
      try {
        await store.saveSupplyDay(day)
        if (pending.current.size === 0) setStatus('saved')
        await loadStock()
      } catch {
        setStatus('error')
        recheckAccess()
      }
    },
    [store, loadStock, recheckAccess],
  )

  const flush = useCallback(() => {
    for (const { day, timer } of pending.current.values()) {
      window.clearTimeout(timer)
      void save(day)
    }
  }, [save])

  useEffect(() => {
    let cancelled = false
    void store.listSupplyDays(date, date).then((list) => {
      if (!cancelled) setLoaded({ date, days: Object.fromEntries(list.map((d) => [d.supplyId, d])) })
    })
    void loadStock()
    return () => {
      cancelled = true
      flush()
    }
  }, [store, date, flush, loadStock])

  const change = (supplyId: string, patch: Partial<SupplyDay>, immediately = false) => {
    if (!days) return
    const next = { ...(days[supplyId] ?? emptyDay(supplyId, date)), ...patch }
    setLoaded({ date, days: { ...days, [supplyId]: next } })
    const existing = pending.current.get(supplyId)
    if (existing) window.clearTimeout(existing.timer)
    if (immediately) {
      void save(next)
      return
    }
    const timer = window.setTimeout(() => void save(next), SAVE_DELAY_MS)
    pending.current.set(supplyId, { day: next, timer })
    setStatus('saving')
  }

  const visible = sortByOrder(supplies.filter((s) => !s.archived))
  const toOrder = visible.filter((s) => stock[s.id] && stockLevel(stock[s.id].stock, s.lowStockAt) !== 'ok')
  const isToday = date === today

  return (
    <div className="screen">
      <PeriodNav
        title={isToday ? t('tabStock') : formatDate(date, locale, { weekday: 'short', day: 'numeric', month: 'short' })}
        subtitle={formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        prevLabel={t('previousDay')}
        nextLabel={t('nextDay')}
        onPrev={() => setDate(addDays(date, -1))}
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

      <div className={`save-status save-status--${status}`} role="status">
        {status === 'saving' && t('saving')}
        {status === 'saved' && `✓ ${t('saved')}`}
        {status === 'error' && t('saveFailed')}
      </div>

      {visible.length === 0 && (
        <EmptyState title={t('noSupplies')} hint={t(role === 'owner' ? 'noSuppliesHint' : 'noSuppliesStaffHint')} />
      )}

      {toOrder.length > 0 && (
        <div className="to-order" role="status">
          <p className="to-order__title">{t('needsOrdering')}</p>
          <ul className="to-order__list">
            {toOrder.map((s) => (
              <li key={s.id}>
                <span>{s.name}</span>
                <StockAmount supply={s} stock={stock[s.id]} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {days &&
        visible.map((supply) => {
          const day = days[supply.id] ?? emptyDay(supply.id, date)
          return (
            <div key={supply.id} className="card supply">
              <div className="supply__head">
                <div className="card__title">{supply.name}</div>
                {stock[supply.id] && <StockAmount supply={supply} stock={stock[supply.id]} withLabel />}
              </div>
              <p className="supply__counted">
                {stock[supply.id]?.countedOn
                  ? t('countedOn', { date: formatDate(stock[supply.id].countedOn!, locale, { day: 'numeric', month: 'long' }) })
                  : t('neverCounted')}
              </p>
              <Stepper
                label={t('received')}
                productName={supply.name}
                unit={supply.unit}
                tone="produced"
                disabled={!canEdit}
                value={day.received}
                onChange={(v) => change(supply.id, { received: v })}
              />
              <Stepper
                label={t('used')}
                productName={supply.name}
                unit={supply.unit}
                tone="neutral"
                disabled={!canEdit}
                value={day.used}
                onChange={(v) => change(supply.id, { used: v })}
              />
              {canEdit && (
                <CountEditor
                  supply={supply}
                  counted={day.counted}
                  onSave={(counted) => change(supply.id, { counted }, true)}
                />
              )}
            </div>
          )
        })}
    </div>
  )
}

function StockAmount({ supply, stock, withLabel = false }: { supply: Supply; stock: SupplyStock; withLabel?: boolean }) {
  const { t, locale } = useI18n()
  const level = stockLevel(stock.stock, supply.lowStockAt)
  const amount = formatQuantity(Math.max(0, stock.stock), supply.unit, locale)
  const unit = t(UNIT_SHORT[supply.unit])
  return (
    <span className={`stock stock--${level}`}>
      {withLabel ? t('inStock', { amount, unit }) : `${amount} ${unit}`}
      {level !== 'ok' && ` · ${t(level === 'out' ? 'stockOut' : 'stockLow')}`}
    </span>
  )
}

/** "Count": set what is actually on the shelf at the end of this day. */
function CountEditor(props: { supply: Supply; counted: number | null; onSave(counted: number | null): void }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const unit = props.supply.unit

  if (!open) {
    return (
      <div className="supply__count">
        {props.counted !== null && (
          <span className="tag">
            {t('counted')}: {formatQuantity(props.counted, unit, locale)} {t(UNIT_SHORT[unit])}
          </span>
        )}
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            setText(props.counted === null ? '' : formatQuantity(props.counted, unit, locale))
            setOpen(true)
          }}
        >
          {t('count')}
        </button>
      </div>
    )
  }

  return (
    <form
      className="supply__count-form"
      onSubmit={(e) => {
        e.preventDefault()
        props.onSave(text.trim() ? parseQuantity(text, unit) : null)
        setOpen(false)
      }}
    >
      <label className="field">
        <span className="field__label">{t('countLabel', { unit: t(UNIT_SHORT[unit]) })}</span>
        <input
          className="field__input"
          inputMode={allowsDecimals(unit) ? 'decimal' : 'numeric'}
          autoFocus
          value={text}
          onChange={(e) => setText(cleanQuantityInput(e.target.value, unit))}
        />
      </label>
      <div className="name-form__actions">
        <button type="submit" className="btn btn--primary">
          {t('save')}
        </button>
        {props.counted !== null && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              props.onSave(null)
              setOpen(false)
            }}
          >
            {t('removeCount')}
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}
