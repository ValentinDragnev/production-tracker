/**
 * Which plan applies and what it allows. Mirrors the database
 * (private.current_tier and the limit functions), which has the final say.
 */

export type PaidTier = 'standard' | 'unlimited'

export interface Subscription {
  trialEndsAt: string
  paidUntil: string | null
  /** Billing period of the last payment. */
  plan: 'monthly' | 'yearly' | null
  /** Plan paid for, valid until paidUntil. */
  tier: PaidTier | null
  locked: boolean
}

/** What the business is on right now. */
export type PlanState =
  | { kind: 'trial'; endsAt: Date; daysLeft: number }
  | { kind: 'paid'; tier: PaidTier; endsAt: Date; daysLeft: number }
  | { kind: 'free'; endedAt: Date | null; wasTrial: boolean }
  | { kind: 'locked' }

export type Tier = 'free' | PaidTier | 'locked'

export interface PlanLimits {
  /** null: unlimited. */
  products: number | null
  staff: number | null
  stock: boolean
  /** All history, month reports. Otherwise the last 7 days only. */
  fullHistory: boolean
}

export const PLAN_LIMITS: Record<Tier, PlanLimits> = {
  free: { products: 5, staff: 1, stock: false, fullHistory: false },
  standard: { products: 15, staff: 2, stock: true, fullHistory: true },
  unlimited: { products: null, staff: null, stock: true, fullHistory: true },
  locked: { products: 0, staff: 0, stock: false, fullHistory: false },
}

/** Days a Free plan can see and edit: today and the 6 before. */
export const FREE_HISTORY_DAYS = 7

/** Show a reminder this many days before a trial or paid period ends. */
export const WARN_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export function planState(sub: Subscription, now: Date = new Date()): PlanState {
  if (sub.locked) return { kind: 'locked' }
  const trialEnd = new Date(sub.trialEndsAt)
  const paidEnd = sub.paidUntil ? new Date(sub.paidUntil) : null
  const daysLeft = (end: Date) => Math.ceil((end.getTime() - now.getTime()) / DAY_MS)

  if (now < trialEnd) {
    // Paid ahead during the trial: show the paid plan's end, no trial nudges.
    if (paidEnd && paidEnd > trialEnd && sub.tier) {
      return { kind: 'paid', tier: sub.tier, endsAt: paidEnd, daysLeft: daysLeft(paidEnd) }
    }
    return { kind: 'trial', endsAt: trialEnd, daysLeft: daysLeft(trialEnd) }
  }
  if (paidEnd && now < paidEnd && sub.tier) {
    return { kind: 'paid', tier: sub.tier, endsAt: paidEnd, daysLeft: daysLeft(paidEnd) }
  }
  const endedAt = paidEnd && paidEnd > trialEnd ? paidEnd : trialEnd
  return { kind: 'free', endedAt, wasTrial: !(paidEnd && paidEnd > trialEnd) }
}

/** The plan whose limits apply now (a trial counts as Unlimited). */
export function currentTier(state: PlanState): Tier {
  switch (state.kind) {
    case 'trial':
      return 'unlimited'
    case 'paid':
      return state.tier
    case 'free':
      return 'free'
    case 'locked':
      return 'locked'
  }
}

export function limitsFor(state: PlanState): PlanLimits {
  return PLAN_LIMITS[currentTier(state)]
}

export function canEnterNumbers(state: PlanState): boolean {
  return state.kind !== 'locked'
}

export function needsReminder(state: PlanState): boolean {
  return (state.kind === 'trial' || state.kind === 'paid') && state.daysLeft <= WARN_DAYS
}

interface Orderable {
  id: string
  sortOrder: number
  archived: boolean
}

/**
 * Ids of the products the plan covers: the first N visible products in
 * Settings order (group order, then product order; ids break ties), the
 * same order the database uses.
 */
export function productsInPlan<G extends Orderable, P extends Orderable & { groupId: string }>(
  groups: G[],
  products: P[],
  limit: number | null,
): Set<string> {
  const byOrder = (a: Orderable, b: Orderable) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const visibleGroups = groups.filter((g) => !g.archived).sort(byOrder)
  const ordered = visibleGroups.flatMap((g) => products.filter((p) => p.groupId === g.id && !p.archived).sort(byOrder))
  return new Set((limit === null ? ordered : ordered.slice(0, limit)).map((p) => p.id))
}
