import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSession } from '../auth/SessionProvider'
import { Admin, loadPriceSettings, type Customer, type Payment, type PaymentMethod, type PriceSettings } from '../data/billing'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { formatMoment, todayInSofia } from '../lib/dates'
import { canEnterNumbers, needsReminder, subscriptionState, type SubscriptionState } from '../lib/subscription'

type Filter = 'all' | 'attention' | 'trial' | 'paid' | 'expired'

const FILTERS: { id: Filter; label: MessageKey }[] = [
  { id: 'attention', label: 'filterAttention' },
  { id: 'all', label: 'filterAll' },
  { id: 'trial', label: 'filterTrial' },
  { id: 'paid', label: 'filterPaid' },
  { id: 'expired', label: 'filterExpired' },
]

const METHODS: { id: PaymentMethod; label: MessageKey }[] = [
  { id: 'bank', label: 'methodBank' },
  { id: 'card', label: 'methodCard' },
  { id: 'cash', label: 'methodCash' },
  { id: 'other', label: 'methodOther' },
]

const DAY_MS = 24 * 60 * 60 * 1000

/** Needs a call or a message: access ends within a week, or already ended. */
function needsAttention(state: SubscriptionState): boolean {
  return needsReminder(state) || !canEnterNumbers(state)
}

function matches(filter: Filter, state: SubscriptionState): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'attention':
      return needsAttention(state)
    case 'trial':
      return state.kind === 'trial'
    case 'paid':
      return state.kind === 'paid'
    case 'expired':
      return state.kind === 'expired' || state.kind === 'locked'
  }
}

/** The platform owner's overview of every customer business. */
export function AdminScreen() {
  const { t } = useI18n()
  const { client } = useSession()
  const admin = useMemo(() => new Admin(client), [client])
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [prices, setPrices] = useState<PriceSettings | null>(null)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([admin.customers(), loadPriceSettings(client)])
      setCustomers(c)
      setPrices(p)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [admin, client])

  useEffect(() => {
    void load()
  }, [load])

  const selected = customers?.find((c) => c.businessId === selectedId)
  if (selected && prices) {
    return (
      <CustomerDetail
        admin={admin}
        customer={selected}
        prices={prices}
        onBack={() => setSelectedId(null)}
        onChanged={load}
      />
    )
  }

  const withState = (customers ?? []).map((c) => ({ customer: c, state: subscriptionState(c.subscription) }))
  const q = query.trim().toLowerCase()
  const shown = withState.filter(
    ({ customer, state }) =>
      matches(filter, state) &&
      (!q || customer.businessName.toLowerCase().includes(q) || (customer.ownerEmail ?? '').includes(q)),
  )

  return (
    <div className="screen">
      <h1 className="screen__title">{t('adminTitle')}</h1>
      {failed && (
        <div className="banner" role="alert">
          <span>{t('loadFailed')}</span>
          <button type="button" className="link-btn" onClick={() => void load()}>
            {t('tryAgain')}
          </button>
        </div>
      )}

      <div className="chips" role="tablist">
        {FILTERS.map((f) => {
          const count = withState.filter(({ state }) => matches(f.id, state)).length
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`chip${filter === f.id ? ' is-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {t(f.label)} <span className="chip__count">{count}</span>
            </button>
          )
        })}
      </div>

      <input
        className="field__input admin__search"
        type="search"
        placeholder={t('searchCustomers')}
        aria-label={t('searchCustomers')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {customers === null && !failed && <p className="muted">{t('loading')}</p>}
      {customers !== null && shown.length === 0 && <p className="muted admin__empty">{t('noCustomers')}</p>}

      {shown.length > 0 && (
        <div className="card card--list">
          {shown.map(({ customer, state }) => (
            <button
              key={customer.businessId}
              type="button"
              className="row row--button customer"
              onClick={() => setSelectedId(customer.businessId)}
            >
              <span className="customer__main">
                <span className="row__name row__name--strong">{customer.businessName}</span>
                <span className="row__detail">{customer.ownerEmail}</span>
                <span className="row__detail">
                  <Activity customer={customer} />
                </span>
              </span>
              <StatusPill state={state} />
            </button>
          ))}
        </div>
      )}

      {prices && <PricesCard admin={admin} prices={prices} onSaved={load} />}
    </div>
  )
}

function Activity({ customer }: { customer: Customer }) {
  const { t, locale } = useI18n()
  if (!customer.lastEntryAt) return <>{t('noActivity')}</>
  return (
    <>
      {t('lastActivity', { date: formatMoment(customer.lastEntryAt, locale) })} ·{' '}
      {t('daysActive', { days: customer.daysEnteredLast7 })}
    </>
  )
}

function StatusPill({ state }: { state: SubscriptionState }) {
  const { t, locale } = useI18n()
  switch (state.kind) {
    case 'locked':
      return <span className="pill pill--high">{t('statusLocked')}</span>
    case 'expired':
      return <span className="pill pill--high">{t('statusExpired', { date: formatMoment(state.endedAt, locale) })}</span>
    case 'trial':
    case 'paid': {
      const tone = needsReminder(state) ? 'pill--medium' : state.kind === 'paid' ? 'pill--low' : 'pill--trial'
      const key = state.kind === 'trial' ? 'statusTrial' : 'statusPaid'
      return <span className={`pill ${tone}`}>{t(key, { date: formatMoment(state.endsAt, locale) })}</span>
    }
  }
}

interface DetailProps {
  admin: Admin
  customer: Customer
  prices: PriceSettings
  onBack(): void
  onChanged(): Promise<void>
}

function CustomerDetail({ admin, customer, prices, onBack, onChanged }: DetailProps) {
  const { t, locale } = useI18n()
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const state = subscriptionState(customer.subscription)
  const money = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: prices.currency }).format(n)

  const loadPayments = useCallback(async () => {
    try {
      setPayments(await admin.payments(customer.businessId))
    } catch {
      setPayments([])
    }
  }, [admin, customer.businessId])

  useEffect(() => {
    void loadPayments()
  }, [loadPayments])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Runs an admin action, then refreshes this customer and their payments.
  const act = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      await Promise.all([onChanged(), loadPayments()])
      return true
    } catch {
      window.alert(t('actionFailed'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const extendTrial = (days: number) => {
    const from = Math.max(new Date(customer.subscription.trialEndsAt).getTime(), Date.now())
    void act(() => admin.setTrialEnd(customer.businessId, new Date(from + days * DAY_MS)))
  }

  return (
    <div className="screen">
      <button type="button" className="link-btn admin__back" onClick={onBack}>
        ‹ {t('back')}
      </button>
      <h1 className="screen__title">{customer.businessName}</h1>

      <div className="card">
        <p className="admin__facts">
          <span>{customer.ownerEmail}</span>
          <span>{t('signedUp', { date: formatMoment(customer.createdAt, locale) })}</span>
          <span>
            {t('staffCount', { count: customer.staffCount })} · {t('productsCount', { count: customer.productsCount })}
          </span>
          <span>
            <Activity customer={customer} />
          </span>
          <span>{t('totalPaid', { amount: money(customer.totalPaid) })}</span>
        </p>
      </div>

      <section className="group">
        <h2 className="group__title">{t('subscription')}</h2>
        <div className="card">
          <StatusPill state={state} />
          <div className="admin__actions">
            <span className="muted">{t('trialPeriod')}:</span>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => extendTrial(7)}>
              {t('extendTrial', { days: 7 })}
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => extendTrial(30)}>
              {t('extendTrial', { days: 30 })}
            </button>
          </div>
          <div className="admin__actions">
            {customer.subscription.locked ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy}
                onClick={() => void act(() => admin.setLocked(customer.businessId, false))}
              >
                {t('unlock')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('lockConfirm'))) void act(() => admin.setLocked(customer.businessId, true))
                }}
              >
                {t('lock')}
              </button>
            )}
          </div>
        </div>
      </section>

      <PaymentForm
        prices={prices}
        busy={busy}
        onSubmit={(p) => act(() => admin.recordPayment({ businessId: customer.businessId, ...p }))}
      />

      <section className="group">
        <h2 className="group__title">{t('payments')}</h2>
        <div className="card card--list">
          {payments?.length === 0 && <p className="muted admin__empty-row">{t('noPayments')}</p>}
          {payments?.map((p) => (
            <div key={p.id} className="row">
              <div className="row__main">
                <div className="row__name">
                  {money(p.amount)} · {t(METHODS.find((m) => m.id === p.method)?.label ?? 'methodOther')}
                </div>
                <div className="row__detail">
                  {formatMoment(p.paidOn, locale)} · {t('coversUntil', { date: formatMoment(p.coversUntil, locale) })}
                  {p.note && ` · ${p.note}`}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('deletePaymentConfirm'))) void act(() => admin.deletePayment(p.id))
                }}
              >
                {t('delete')}
              </button>
            </div>
          ))}
        </div>
      </section>

      <NotesCard
        key={customer.businessId}
        phone={customer.phone ?? ''}
        notes={customer.notes ?? ''}
        onSave={(phone, notes) => admin.saveNotes(customer.businessId, phone, notes).then(onChanged)}
      />
    </div>
  )
}

function PaymentForm(props: {
  prices: PriceSettings
  busy: boolean
  /** Resolves true when the payment was recorded. */
  onSubmit(p: { amount: number; months: number; method: PaymentMethod; paidOn: string; note: string }): Promise<boolean>
}) {
  const { t } = useI18n()
  const priceFor = (months: number) => (months === 12 ? props.prices.yearlyPrice : props.prices.monthlyPrice)
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState(priceFor(1)?.toString() ?? '')
  const [method, setMethod] = useState<PaymentMethod>('bank')
  const [paidOn, setPaidOn] = useState(todayInSofia())
  const [note, setNote] = useState('')
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)

  const choose = (m: number) => {
    setMonths(m)
    setAmount(priceFor(m)?.toString() ?? '')
    setSaved(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = Number(amount.replace(',', '.'))
    if (!amount.trim() || !Number.isFinite(value) || value < 0) {
      setError(true)
      return
    }
    if (await props.onSubmit({ amount: value, months, method, paidOn, note })) {
      setNote('')
      setSaved(true)
    }
  }

  return (
    <section className="group">
      <h2 className="group__title">{t('recordPayment')}</h2>
      <form className="card admin__form" onSubmit={submit} noValidate>
        <div className="segmented">
          {[1, 12].map((m) => (
            <button
              key={m}
              type="button"
              className={months === m ? 'is-active' : ''}
              aria-pressed={months === m}
              onClick={() => choose(m)}
            >
              {t(m === 12 ? 'planYear' : 'planMonth')}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">{t('amount')}</span>
          <input
            className="field__input"
            inputMode="decimal"
            value={amount}
            aria-invalid={error}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(false)
              setSaved(false)
            }}
          />
          {error && <span className="field__error">{t('amountInvalid')}</span>}
        </label>
        <label className="field">
          <span className="field__label">{t('method')}</span>
          <select className="field__input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{t('paidOn')}</span>
          <input className="field__input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t('note')}</span>
          <input className="field__input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
        {saved && <p className="admin__saved">✓ {t('paymentSaved')}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={props.busy}>
          {t('recordPayment')}
        </button>
      </form>
    </section>
  )
}

function NotesCard(props: { phone: string; notes: string; onSave(phone: string, notes: string): Promise<void> }) {
  const { t } = useI18n()
  const [phone, setPhone] = useState(props.phone)
  const [notes, setNotes] = useState(props.notes)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  return (
    <section className="group">
      <h2 className="group__title">{t('contactAndNotes')}</h2>
      <form
        className="card admin__form"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await props.onSave(phone, notes)
            setStatus('saved')
          } catch {
            setStatus('error')
          }
        }}
      >
        <label className="field">
          <span className="field__label">{t('phone')}</span>
          <input
            className="field__input"
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setStatus('idle')
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('notes')}</span>
          <textarea
            className="field__input field__textarea"
            rows={4}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setStatus('idle')
            }}
          />
        </label>
        {status === 'saved' && <p className="admin__saved">✓ {t('saved')}</p>}
        {status === 'error' && <p className="field__error">{t('actionFailed')}</p>}
        <button type="submit" className="btn btn--secondary">
          {t('save')}
        </button>
      </form>
    </section>
  )
}

function PricesCard(props: { admin: Admin; prices: PriceSettings; onSaved(): Promise<void> }) {
  const { t } = useI18n()
  const [monthly, setMonthly] = useState(props.prices.monthlyPrice?.toString() ?? '')
  const [yearly, setYearly] = useState(props.prices.yearlyPrice?.toString() ?? '')
  const [infoBg, setInfoBg] = useState(props.prices.paymentInfoBg)
  const [infoEn, setInfoEn] = useState(props.prices.paymentInfoEn)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Empty means "no price shown"; anything else must be a valid amount.
  const parse = (v: string): number | null | undefined => {
    if (!v.trim()) return null
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }

  const changed = (fn: (v: string) => void) => (e: { target: { value: string } }) => {
    fn(e.target.value)
    setStatus('idle')
  }

  return (
    <section className="group">
      <h2 className="group__title">{t('pricesTitle')}</h2>
      <form
        className="card admin__form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          const m = parse(monthly)
          const y = parse(yearly)
          if (m === undefined || y === undefined) {
            setStatus('error')
            return
          }
          try {
            await props.admin.saveSettings({
              ...props.prices,
              monthlyPrice: m,
              yearlyPrice: y,
              paymentInfoBg: infoBg,
              paymentInfoEn: infoEn,
            })
            await props.onSaved()
            setStatus('saved')
          } catch {
            setStatus('error')
          }
        }}
      >
        <div className="admin__pair">
          <label className="field">
            <span className="field__label">{t('monthlyPrice')}</span>
            <input className="field__input" inputMode="decimal" value={monthly} onChange={changed(setMonthly)} />
          </label>
          <label className="field">
            <span className="field__label">{t('yearlyPrice')}</span>
            <input className="field__input" inputMode="decimal" value={yearly} onChange={changed(setYearly)} />
          </label>
        </div>
        <p className="muted">{t('paymentInfoHint')}</p>
        <label className="field">
          <span className="field__label">{t('paymentInfoBg')}</span>
          <textarea className="field__input field__textarea" rows={4} value={infoBg} onChange={changed(setInfoBg)} />
        </label>
        <label className="field">
          <span className="field__label">{t('paymentInfoEn')}</span>
          <textarea className="field__input field__textarea" rows={4} value={infoEn} onChange={changed(setInfoEn)} />
        </label>
        {status === 'saved' && <p className="admin__saved">✓ {t('saved')}</p>}
        {status === 'error' && <p className="field__error">{t('actionFailed')}</p>}
        <button type="submit" className="btn btn--secondary">
          {t('save')}
        </button>
      </form>
    </section>
  )
}
