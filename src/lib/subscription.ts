/** Mirrors the database's rule (private.is_active) for what the app shows. */

export interface Subscription {
  trialEndsAt: string
  paidUntil: string | null
  plan: 'monthly' | 'yearly' | null
  locked: boolean
}

export type SubscriptionState =
  | { kind: 'trial'; endsAt: Date; daysLeft: number }
  | { kind: 'paid'; endsAt: Date; daysLeft: number }
  | { kind: 'expired'; endedAt: Date }
  | { kind: 'locked' }

/** Show a reminder this many days before access runs out. */
export const WARN_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export function subscriptionState(sub: Subscription, now: Date = new Date()): SubscriptionState {
  if (sub.locked) return { kind: 'locked' }
  const trialEnd = new Date(sub.trialEndsAt)
  const paidEnd = sub.paidUntil ? new Date(sub.paidUntil) : null
  const end = paidEnd && paidEnd > trialEnd ? paidEnd : trialEnd
  if (now >= end) return { kind: 'expired', endedAt: end }
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY_MS)
  // Once someone has paid past the trial, they're a paying customer even
  // while trial days remain: no "trial ending" nudges for them.
  return paidEnd && paidEnd > trialEnd ? { kind: 'paid', endsAt: end, daysLeft } : { kind: 'trial', endsAt: end, daysLeft }
}

export function canEnterNumbers(state: SubscriptionState): boolean {
  return state.kind === 'trial' || state.kind === 'paid'
}

export function needsReminder(state: SubscriptionState): boolean {
  return (state.kind === 'trial' || state.kind === 'paid') && state.daysLeft <= WARN_DAYS
}
