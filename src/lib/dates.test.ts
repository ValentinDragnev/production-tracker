import { describe, expect, it } from 'vitest'
import { addDays, addMonths, monthDates, startOfMonth, startOfWeek, todayInSofia, weekDates } from './dates'

describe('todayInSofia', () => {
  it('uses Sofia time, not UTC', () => {
    // 22:30 UTC on 5 Oct is already 01:30 on 6 Oct in Sofia (UTC+3)
    expect(todayInSofia(new Date('2026-10-05T22:30:00Z'))).toBe('2026-10-06')
    expect(todayInSofia(new Date('2026-10-05T20:59:00Z'))).toBe('2026-10-05')
  })
})

describe('addDays', () => {
  it('crosses months, years and DST changes', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26') // DST ends in Sofia
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('weeks', () => {
  it('start on Monday', () => {
    expect(startOfWeek('2026-10-06')).toBe('2026-10-05') // Tuesday
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05') // Monday
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05') // Sunday
  })

  it('run Monday to Sunday', () => {
    const week = weekDates('2026-10-01')
    expect(week).toHaveLength(7)
    expect(week[0]).toBe('2026-09-28')
    expect(week[6]).toBe('2026-10-04')
  })
})

describe('months', () => {
  it('start on the 1st and step across years', () => {
    expect(startOfMonth('2026-10-08')).toBe('2026-10-01')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-01')
  })

  it('list every day, including leap days', () => {
    expect(monthDates('2026-10-08')).toHaveLength(31)
    expect(monthDates('2028-02-10').at(-1)).toBe('2028-02-29')
  })
})
