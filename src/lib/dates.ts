import type { ISODate } from '../data/types'

export const TIME_ZONE = 'Europe/Sofia'

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's date in Sofia, regardless of the device's own time zone. */
export function todayInSofia(now: Date = new Date()): ISODate {
  return isoFormatter.format(now)
}

// Date-only arithmetic runs in UTC so DST changes can't shift the day.
function toUtc(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtc(date: Date): ISODate {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  const weekday = toUtc(date).getUTCDay() // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7))
}

/** The seven dates Monday..Sunday of the week containing `date`. */
export function weekDates(date: ISODate): ISODate[] {
  const monday = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export function formatDate(date: ISODate, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(toUtc(date))
}

/** A moment in time (e.g. a subscription end) as a Sofia calendar date. */
export function formatMoment(moment: string | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE }).format(
    new Date(moment),
  )
}
