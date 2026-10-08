import { describe, expect, it } from 'vitest'
import {
  canEnterNumbers,
  currentTier,
  limitsFor,
  needsReminder,
  planState,
  productsInPlan,
  type Subscription,
} from './subscription'

const now = new Date('2026-10-07T12:00:00Z')
const sub = (over: Partial<Subscription>): Subscription => ({
  trialEndsAt: '2026-11-06T12:00:00Z',
  paidUntil: null,
  plan: null,
  tier: null,
  locked: false,
  ...over,
})

describe('planState', () => {
  it('is an Unlimited trial for the first 30 days', () => {
    const s = planState(sub({}), now)
    expect(s).toEqual({ kind: 'trial', endsAt: new Date('2026-11-06T12:00:00Z'), daysLeft: 30 })
    expect(currentTier(s)).toBe('unlimited')
  })

  it('rounds partial days up', () => {
    expect(planState(sub({ trialEndsAt: '2026-10-07T13:00:00Z' }), now)).toMatchObject({ kind: 'trial', daysLeft: 1 })
  })

  it('falls back to Free when the trial ends unpaid, without locking', () => {
    const s = planState(sub({ trialEndsAt: '2026-10-06T12:00:00Z' }), now)
    expect(s).toEqual({ kind: 'free', endedAt: new Date('2026-10-06T12:00:00Z'), wasTrial: true })
    expect(canEnterNumbers(s)).toBe(true)
    expect(limitsFor(s)).toEqual({ products: 5, staff: 1, stock: false, fullHistory: false })
  })

  it('applies the paid plan after the trial', () => {
    const s = planState(sub({ trialEndsAt: '2026-10-01T00:00:00Z', paidUntil: '2026-11-01T00:00:00Z', tier: 'standard' }), now)
    expect(s).toMatchObject({ kind: 'paid', tier: 'standard' })
    expect(limitsFor(s)).toEqual({ products: 15, staff: 2, stock: true, fullHistory: true })
  })

  it('shows a plan paid ahead during the trial as paid', () => {
    const s = planState(sub({ paidUntil: '2027-11-06T12:00:00Z', tier: 'unlimited', plan: 'yearly' }), now)
    expect(s).toMatchObject({ kind: 'paid', tier: 'unlimited', daysLeft: 395 })
  })

  it('falls back to Free when a paid plan ends', () => {
    const s = planState(sub({ trialEndsAt: '2026-08-01T00:00:00Z', paidUntil: '2026-10-01T00:00:00Z', tier: 'standard' }), now)
    expect(s).toEqual({ kind: 'free', endedAt: new Date('2026-10-01T00:00:00Z'), wasTrial: false })
  })

  it('only the admin lock stops entry', () => {
    const s = planState(sub({ paidUntil: '2027-01-01T00:00:00Z', tier: 'unlimited', locked: true }), now)
    expect(s).toEqual({ kind: 'locked' })
    expect(canEnterNumbers(s)).toBe(false)
  })
})

describe('needsReminder', () => {
  it('starts 7 days before the end of a trial or paid plan', () => {
    expect(needsReminder(planState(sub({ trialEndsAt: '2026-10-14T12:00:00Z' }), now))).toBe(true)
    expect(needsReminder(planState(sub({ trialEndsAt: '2026-10-15T12:00:00Z' }), now))).toBe(false)
  })

  it('is not shown on the Free plan', () => {
    expect(needsReminder(planState(sub({ trialEndsAt: '2026-10-01T00:00:00Z' }), now))).toBe(false)
  })
})

describe('productsInPlan', () => {
  const groups = [
    { id: 'g2', sortOrder: 2, archived: false },
    { id: 'g1', sortOrder: 1, archived: false },
    { id: 'g3', sortOrder: 3, archived: true },
  ]
  const products = [
    { id: 'b', groupId: 'g1', sortOrder: 2, archived: false },
    { id: 'a', groupId: 'g1', sortOrder: 1, archived: false },
    { id: 'hidden', groupId: 'g1', sortOrder: 0, archived: true },
    { id: 'c', groupId: 'g2', sortOrder: 1, archived: false },
    { id: 'in-hidden-group', groupId: 'g3', sortOrder: 1, archived: false },
    { id: 'd', groupId: 'g2', sortOrder: 1, archived: false }, // same order as c: id decides
  ]

  it('takes the first N visible products in Settings order', () => {
    expect([...productsInPlan(groups, products, 3)]).toEqual(['a', 'b', 'c'])
  })

  it('covers every visible product without a limit', () => {
    expect([...productsInPlan(groups, products, null)]).toEqual(['a', 'b', 'c', 'd'])
  })
})
