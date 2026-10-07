import { useOptionalSession } from '../auth/SessionProvider'
import type { PriceSettings } from '../data/billing'
import { useI18n } from '../i18n/I18nProvider'
import { formatMoment } from '../lib/dates'
import { canEnterNumbers, needsReminder, subscriptionState, type SubscriptionState } from '../lib/subscription'

/** The signed-in business's subscription, or null in demo mode / before login. */
function useSubscription() {
  const session = useOptionalSession()
  if (session?.state.status !== 'ready') return null
  const { subscription, prices, business } = session.state
  if (!subscription) return null
  return {
    state: subscriptionState(subscription),
    everPaid: subscription.paidUntil !== null,
    prices,
    isOwner: business.role === 'owner',
  }
}

/**
 * Top of the Today screen: a reminder in the last week, or the locked notice
 * once the trial / paid period is over. Nothing otherwise.
 */
export function SubscriptionNotice({ onHowToPay }: { onHowToPay(): void }) {
  const { t, locale } = useI18n()
  const sub = useSubscription()
  if (!sub) return null

  if (!canEnterNumbers(sub.state)) {
    return (
      <div className="locked" role="alert">
        <p className="locked__title">{lockedTitle(sub.state, sub.everPaid, t)}</p>
        <p className="locked__body">{t(sub.isOwner ? 'subOwnerBody' : 'subStaffBody')}</p>
        {sub.isOwner && <PaymentInfo prices={sub.prices} />}
      </div>
    )
  }

  if (needsReminder(sub.state) && sub.isOwner && (sub.state.kind === 'trial' || sub.state.kind === 'paid')) {
    const date = formatMoment(sub.state.endsAt, locale)
    return (
      <div className="reminder" role="status">
        <span>{t(sub.state.kind === 'trial' ? 'subTrialEnding' : 'subPaidEnding', { date })}</span>
        <button type="button" className="link-btn" onClick={onHowToPay}>
          {t('howToPay')}
        </button>
      </div>
    )
  }
  return null
}

/** Settings section: where the subscription stands, and how to pay (owners). */
export function SubscriptionSection() {
  const { t, locale } = useI18n()
  const sub = useSubscription()
  if (!sub) return null
  const { state } = sub

  const line =
    state.kind === 'trial'
      ? t('subTrialUntil', { date: formatMoment(state.endsAt, locale) })
      : state.kind === 'paid'
        ? t('subPaidUntil', { date: formatMoment(state.endsAt, locale) })
        : lockedTitle(state, sub.everPaid, t)

  return (
    <section className="group" id="subscription">
      <h2 className="group__title">{t('subscription')}</h2>
      <div className={`card${canEnterNumbers(state) ? '' : ' card--alert'}`}>
        <div className="card__title">{line}</div>
        {!canEnterNumbers(state) && <p className="muted">{t(sub.isOwner ? 'subOwnerBody' : 'subStaffBody')}</p>}
        {sub.isOwner && <PaymentInfo prices={sub.prices} />}
      </div>
    </section>
  )
}

function PaymentInfo({ prices }: { prices: PriceSettings | null }) {
  const { t, lang, locale } = useI18n()
  if (!prices) return <p className="pay-info__text">{t('paymentContact')}</p>
  const money = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: prices.currency }).format(n)
  // Fall back to the other language rather than show nothing.
  const info = (lang === 'bg' ? prices.paymentInfoBg || prices.paymentInfoEn : prices.paymentInfoEn || prices.paymentInfoBg).trim()

  return (
    <div className="pay-info">
      {(prices.monthlyPrice !== null || prices.yearlyPrice !== null) && (
        <p className="pay-info__prices">
          {prices.monthlyPrice !== null && <span>{t('priceMonthly', { price: money(prices.monthlyPrice) })}</span>}
          {prices.yearlyPrice !== null && <span>{t('priceYearly', { price: money(prices.yearlyPrice) })}</span>}
        </p>
      )}
      <p className="pay-info__text">{info || t('paymentContact')}</p>
    </div>
  )
}

function lockedTitle(state: SubscriptionState, everPaid: boolean, t: ReturnType<typeof useI18n>['t']): string {
  if (state.kind === 'locked') return t('subLockedTitle')
  return t(everPaid ? 'subExpiredTitle' : 'subExpiredTrialTitle')
}
