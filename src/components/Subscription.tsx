import { useOptionalSession } from '../auth/SessionProvider'
import type { PriceSettings } from '../data/billing'
import { useStore } from '../data/StoreProvider'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { formatMoment } from '../lib/dates'
import { currentTier, needsReminder, planState, type PlanState, type Tier } from '../lib/subscription'
import { QrCode } from './QrCode'

const PLAN_NAME: Record<Exclude<Tier, 'locked'>, MessageKey> = {
  free: 'planFree',
  standard: 'planStandard',
  unlimited: 'planUnlimited',
}

const PLAN_INCLUDES: Record<Exclude<Tier, 'locked'>, MessageKey> = {
  free: 'planIncludesFree',
  standard: 'planIncludesStandard',
  unlimited: 'planIncludesUnlimited',
}

/** The signed-in business's plan, or null in demo mode / before login. */
function usePlan() {
  const session = useOptionalSession()
  if (session?.state.status !== 'ready') return null
  const { subscription, prices, business } = session.state
  if (!subscription) return null
  return {
    state: planState(subscription),
    prices,
    businessName: business.name,
    isOwner: business.role === 'owner',
  }
}

/**
 * Top of the Today and Stock screens: the admin's lock, a staff member the
 * plan doesn't cover, or a reminder in the last week of a trial / paid plan.
 */
export function SubscriptionNotice({ onHowToPay }: { onHowToPay(): void }) {
  const { t, locale } = useI18n()
  const { staffBlocked } = useStore()
  const plan = usePlan()
  if (!plan) return null

  if (plan.state.kind === 'locked') {
    return (
      <div className="locked" role="alert">
        <p className="locked__title">{t('subLockedTitle')}</p>
        <p className="locked__body">{t(plan.isOwner ? 'subOwnerBody' : 'subStaffBody')}</p>
        {plan.prices?.contactEmail && <ContactLine email={plan.prices.contactEmail} />}
      </div>
    )
  }

  if (staffBlocked) {
    return (
      <div className="reminder" role="status">
        <span>{t('staffNotInPlan')}</span>
      </div>
    )
  }

  if (needsReminder(plan.state) && plan.isOwner && (plan.state.kind === 'trial' || plan.state.kind === 'paid')) {
    const date = formatMoment(plan.state.endsAt, locale)
    return (
      <div className="reminder" role="status">
        <span>{t(plan.state.kind === 'trial' ? 'subTrialEnding' : 'subPaidEnding', { date })}</span>
        <button type="button" className="link-btn" onClick={onHowToPay}>
          {t('seePlans')}
        </button>
      </div>
    )
  }
  return null
}

/** Settings: the current plan, what it includes, usage, and how to upgrade (owners). */
export function SubscriptionSection() {
  const { t } = useI18n()
  const { limits, products } = useStore()
  const plan = usePlan()
  if (!plan) return null
  const { state } = plan
  const tier = currentTier(state)
  const activeProducts = products.filter((p) => !p.archived).length
  // A paid plan that isn't ending only needs the bigger plan; everyone else
  // (trial, Free, a plan about to end) sees both paid plans.
  const settled = state.kind === 'paid' && !needsReminder(state)
  const showChoices = state.kind !== 'locked' && !(settled && state.tier === 'unlimited')
  const hide = settled ? tier : null

  return (
    <section className="group" id="subscription">
      <h2 className="group__title">{t('subscription')}</h2>
      <div className={`card plan${state.kind === 'locked' ? ' card--alert' : ''}`}>
        <PlanHeadline state={state} />
        {tier !== 'locked' && <p className="muted plan__includes">{t(PLAN_INCLUDES[tier])}</p>}
        {state.kind === 'locked' && <p className="muted">{t(plan.isOwner ? 'subOwnerBody' : 'subStaffBody')}</p>}
        {plan.isOwner && limits.products !== null && state.kind !== 'locked' && (
          <p className={activeProducts > limits.products ? 'plan__usage plan__usage--over' : 'plan__usage'}>
            {t('usageProducts', { used: activeProducts, limit: limits.products })}
          </p>
        )}
        {plan.isOwner && showChoices && <PlanChoices prices={plan.prices} reference={plan.businessName} current={hide} />}
      </div>
    </section>
  )
}

function PlanHeadline({ state }: { state: PlanState }) {
  const { t, locale } = useI18n()
  switch (state.kind) {
    case 'trial':
      return <div className="card__title">{t('subTrialUntil', { date: formatMoment(state.endsAt, locale) })}</div>
    case 'paid':
      return (
        <div className="card__title">
          {t('yourPlan', { plan: t(PLAN_NAME[state.tier]) })} · {t('subPaidUntil', { date: formatMoment(state.endsAt, locale) })}
        </div>
      )
    case 'free':
      return <div className="card__title">{t('yourPlan', { plan: t('planFree') })}</div>
    case 'locked':
      return <div className="card__title">{t('subLockedTitle')}</div>
  }
}

/**
 * Upsell for a paid feature (Stock, month report). Owners see the plans and
 * how to pay; staff just the explanation.
 */
export function PlanUpsell({ title, body }: { title: MessageKey; body?: MessageKey }) {
  const { t } = useI18n()
  const plan = usePlan()
  return (
    <div className="card upsell">
      <p className="upsell__title">{t(title)}</p>
      {body && <p className="muted">{t(body)}</p>}
      <p className="muted">{t('planIncludesStandard')}</p>
      {plan?.isOwner && <PlanChoices prices={plan.prices} reference={plan.businessName} current={currentTier(plan.state)} />}
    </div>
  )
}

/** The paid plans with their prices, then the ways to pay. */
function PlanChoices(props: { prices: PriceSettings | null; reference: string; current: Tier | null }) {
  const { t, locale } = useI18n()
  const { prices } = props
  if (!prices) return <p className="pay-info__text">{t('paymentContact')}</p>
  const money = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: prices.currency }).format(n)
  const options = [
    { tier: 'standard' as const, monthly: prices.standardMonthly, yearly: prices.standardYearly },
    { tier: 'unlimited' as const, monthly: prices.unlimitedMonthly, yearly: prices.unlimitedYearly },
  ].filter((o) => o.tier !== props.current && (o.monthly !== null || o.yearly !== null))

  return (
    <div className="pay-info">
      {options.length > 0 && (
        <>
          <p className="pay-info__heading">{t('choosePlan')}</p>
          <ul className="plan-options">
            {options.map((o) => (
              <li key={o.tier} className="plan-option">
                <span className="plan-option__name">{t(PLAN_NAME[o.tier])}</span>
                <span className="plan-option__price">
                  {[
                    o.monthly !== null ? t('pricePerMonth', { price: money(o.monthly) }) : '',
                    o.yearly !== null ? t('pricePerYear', { price: money(o.yearly) }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="plan-option__includes">{t(PLAN_INCLUDES[o.tier])}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <PaymentMethods prices={prices} reference={props.reference} />
    </div>
  )
}

/** Revolut (button + QR), bank details, contact. */
function PaymentMethods({ prices, reference }: { prices: PriceSettings; reference: string }) {
  const { t, lang } = useI18n()
  // Fall back to the other language rather than show nothing.
  const info = (lang === 'bg' ? prices.paymentInfoBg || prices.paymentInfoEn : prices.paymentInfoEn || prices.paymentInfoBg).trim()
  return (
    <>
      {prices.revolutLink && (
        <div className="pay-info__revolut">
          <a className="btn btn--primary btn--block" href={prices.revolutLink} target="_blank" rel="noopener noreferrer">
            {t('payWithRevolut')}
          </a>
          <p className="pay-info__ref">{t('paymentReference', { reference })}</p>
          <p className="muted">{t('scanToPay')}</p>
          <QrCode value={prices.revolutLink} label={t('payWithRevolut')} />
        </div>
      )}
      {info && prices.revolutLink && <p className="pay-info__or">{t('orBankTransfer')}</p>}
      {(info || !prices.revolutLink) && <p className="pay-info__text">{info || t('paymentContact')}</p>}
      {prices.contactEmail && <ContactLine email={prices.contactEmail} />}
    </>
  )
}

export function ContactLine({ email }: { email: string }) {
  const { t } = useI18n()
  return (
    <p className="contact-line">
      {t('contactUs')}{' '}
      <a href={`mailto:${email}`} className="contact-line__link">
        {email}
      </a>
    </p>
  )
}

/** Settings: where to write with questions. Nothing in demo mode. */
export function HelpSection() {
  const { t } = useI18n()
  const session = useOptionalSession()
  const email = session?.state.status === 'ready' ? session.state.prices?.contactEmail : ''
  if (!email) return null
  return (
    <section className="group">
      <h2 className="group__title">{t('help')}</h2>
      <div className="card">
        <ContactLine email={email} />
      </div>
    </section>
  )
}
