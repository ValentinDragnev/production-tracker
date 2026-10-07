import { describe, expect, it } from 'vitest'
import { canEnterNumbers, needsReminder, subscriptionState, type Subscription } from './subscription'

const now = new Date('2026-10-07T12:00:00Z')
const sub = (over: Partial<Subscription>): Subscription => ({
  trialEndsAt: '2026-11-06T12:00:00Z',
  paidUntil: null,
  plan: null,
  locked: false,
  ...over,
})

describe('subscriptionState', () => {
  it('is a trial with days left', () => {
    expect(subscriptionState(sub({}), now)).toEqual({ kind: 'trial', endsAt: new Date('2026-11-06T12:00:00Z'), daysLeft: 30 })
  })

  it('rounds partial days up', () => {
    const s = subscriptionState(sub({ trialEndsAt: '2026-10-07T13:00:00Z' }), now)
    expect(s).toMatchObject({ kind: 'trial', daysLeft: 1 })
  })

  it('expires when the trial is over and nothing is paid', () => {
    const s = subscriptionState(sub({ trialEndsAt: '2026-10-06T12:00:00Z' }), now)
    expect(s).toEqual({ kind: 'expired', endedAt: new Date('2026-10-06T12:00:00Z') })
    expect(canEnterNumbers(s)).toBe(false)
  })

  it('counts as paid once paid past the trial, even during it', () => {
    const s = subscriptionState(sub({ paidUntil: '2027-11-06T12:00:00Z', plan: 'yearly' }), now)
    expect(s).toMatchObject({ kind: 'paid', daysLeft: 395 })
  })

  it('expires when the paid period is over', () => {
    const s = subscriptionState(sub({ trialEndsAt: '2026-08-01T00:00:00Z', paidUntil: '2026-10-01T00:00:00Z' }), now)
    expect(s.kind).toBe('expired')
  })

  it('a manual lock wins over any dates', () => {
    const s = subscriptionState(sub({ paidUntil: '2027-01-01T00:00:00Z', locked: true }), now)
    expect(s).toEqual({ kind: 'locked' })
    expect(canEnterNumbers(s)).toBe(false)
  })
})

describe('needsReminder', () => {
  it('starts 7 days before the end', () => {
    expect(needsReminder(subscriptionState(sub({ trialEndsAt: '2026-10-14T12:00:00Z' }), now))).toBe(true)
    expect(needsReminder(subscriptionState(sub({ trialEndsAt: '2026-10-15T12:00:00Z' }), now))).toBe(false)
  })

  it('is not shown once access has ended', () => {
    expect(needsReminder(subscriptionState(sub({ trialEndsAt: '2026-10-01T00:00:00Z' }), now))).toBe(false)
  })
})
