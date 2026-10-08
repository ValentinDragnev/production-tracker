// Reminder email text and HTML. No imports, so it runs both in the Supabase
// function (Deno) and in the app's unit tests (Node).

export type ReminderKind = 'week' | 'day' | 'ended'
export type PaidTier = 'standard' | 'unlimited'

export interface ReminderInput {
  kind: ReminderKind
  isTrial: boolean
  /** The paid plan that is ending (null for a trial). */
  tier: PaidTier | null
  businessName: string
  periodEnd: string | Date
  standardMonthly: number | null
  standardYearly: number | null
  unlimitedMonthly: number | null
  unlimitedYearly: number | null
  currency: string
  revolutLink: string
  paymentInfoBg: string
  paymentInfoEn: string
  contactEmail: string
  appUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const TIME_ZONE = 'Europe/Sofia'

function formatDay(moment: string | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE }).format(
    new Date(moment),
  )
}

function money(n: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface Wording {
  subject: string
  lead: string
  freePlan: string
  prices: string
  payRevolut: string
  reference: string
  orBank: string
  openApp: string
  questions: string
}

function priceLine(name: string, monthly: number | null, yearly: number | null, perMonth: string, perYear: string, currency: string, locale: string): string {
  const parts = [
    monthly !== null ? `${money(monthly, currency, locale)} ${perMonth}` : '',
    yearly !== null ? `${money(yearly, currency, locale)} ${perYear}` : '',
  ].filter(Boolean)
  return parts.length ? `${name}: ${parts.join(' / ')}` : ''
}

function bulgarian(i: ReminderInput): Wording {
  const date = formatDay(i.periodEnd, 'bg-BG')
  const planName = i.tier === 'standard' ? 'Стандарт' : 'Неограничен'
  const what = i.isTrial ? 'Пробният период' : `Абонаментът „${planName}“`
  const prices = [
    priceLine('Стандарт (до 15 продукта, 2 служители, Склад)', i.standardMonthly, i.standardYearly, 'на месец', 'на година', i.currency, 'bg-BG'),
    priceLine('Неограничен (без ограничения)', i.unlimitedMonthly, i.unlimitedYearly, 'на месец', 'на година', i.currency, 'bg-BG'),
  ]
    .filter(Boolean)
    .join('\n')
  return {
    subject:
      i.kind === 'ended'
        ? i.isTrial
          ? 'Пробният ви период приключи'
          : 'Абонаментът ви изтече'
        : `${i.isTrial ? 'Пробният ви период' : 'Абонаментът ви'} изтича на ${date}`,
    lead:
      i.kind === 'ended'
        ? `${what} на ${i.businessName} в „Производство и брак“ приключи на ${date} и вече сте на безплатния план. Данните ви са запазени и всичко се връща, щом изберете план.`
        : `${what} на ${i.businessName} в „Производство и брак“ изтича на ${date}. След това минавате на безплатния план, освен ако не изберете план.`,
    freePlan: 'Безплатният план включва до 5 продукта, 1 служител и отчети за последните 7 дни, без Склад.',
    prices,
    payRevolut: 'Плати с Revolut',
    reference: `В основанието напишете: ${i.businessName} и плана (Стандарт или Неограничен)`,
    orBank: 'Или по банков път:',
    openApp: 'Отворете приложението',
    questions: i.contactEmail
      ? `Въпроси? Пишете ни на ${i.contactEmail} или просто отговорете на това писмо.`
      : 'Въпроси? Просто отговорете на това писмо.',
  }
}

function english(i: ReminderInput): Wording {
  const date = formatDay(i.periodEnd, 'en-GB')
  const planName = i.tier === 'standard' ? 'Standard' : 'Unlimited'
  const what = i.isTrial ? 'trial' : `${planName} subscription`
  const prices = [
    priceLine('Standard (up to 15 products, 2 staff, Stock)', i.standardMonthly, i.standardYearly, 'a month', 'a year', i.currency, 'en-GB'),
    priceLine('Unlimited (no limits)', i.unlimitedMonthly, i.unlimitedYearly, 'a month', 'a year', i.currency, 'en-GB'),
  ]
    .filter(Boolean)
    .join('\n')
  return {
    subject: i.kind === 'ended' ? `Your ${what} has ended` : `Your ${what} ends on ${date}`,
    lead:
      i.kind === 'ended'
        ? `The ${what} for ${i.businessName} in Production and waste ended on ${date}, and you are now on the Free plan. Your data is kept, and everything comes back when you pick a plan.`
        : `The ${what} for ${i.businessName} in Production and waste ends on ${date}. After that you move to the Free plan, unless you pick a plan.`,
    freePlan: 'The Free plan includes up to 5 products, 1 staff member and reports for the last 7 days, without Stock.',
    prices,
    payRevolut: 'Pay with Revolut',
    reference: `As the payment note, write: ${i.businessName} and the plan (Standard or Unlimited)`,
    orBank: 'Or by bank transfer:',
    openApp: 'Open the app',
    questions: i.contactEmail
      ? `Questions? Email us at ${i.contactEmail} or just reply to this email.`
      : 'Questions? Just reply to this email.',
  }
}

function htmlSection(w: Wording, i: ReminderInput, bankInfo: string): string {
  const p = (text: string, style = '') =>
    `<p style="font-size: 15px; line-height: 1.5; margin: 0 0 12px;${style}">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
  return [
    p(w.lead),
    p(w.freePlan, ' color: #5f5e5a;'),
    w.prices ? p(w.prices, ' font-weight: bold;') : '',
    i.revolutLink
      ? `<p style="margin: 16px 0 8px;"><a href="${escapeHtml(i.revolutLink)}" style="display: inline-block; background: #0f6e56; color: #ffffff; text-decoration: none; font-weight: bold; padding: 12px 20px; border-radius: 10px;">${escapeHtml(w.payRevolut)}</a></p>` +
        p(w.reference, ' color: #5f5e5a;')
      : '',
    bankInfo ? p(w.orBank, ' font-weight: bold; margin-top: 16px;') + p(bankInfo) : '',
    `<p style="font-size: 15px; margin: 16px 0 12px;"><a href="${escapeHtml(i.appUrl)}" style="color: #0f6e56; font-weight: bold;">${escapeHtml(w.openApp)}</a></p>`,
    p(w.questions, ' color: #5f5e5a; font-size: 14px;'),
  ].join('')
}

function textSection(w: Wording, i: ReminderInput, bankInfo: string): string {
  return [
    w.lead,
    w.freePlan,
    w.prices,
    i.revolutLink ? `${w.payRevolut}: ${i.revolutLink}\n${w.reference}` : '',
    bankInfo ? `${w.orBank}\n${bankInfo}` : '',
    `${w.openApp}: ${i.appUrl}`,
    w.questions,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Bulgarian first, then English, in one email (we don't know the owner's language). */
export function renderReminder(i: ReminderInput): RenderedEmail {
  const bg = bulgarian(i)
  const en = english(i)
  const bankBg = (i.paymentInfoBg || i.paymentInfoEn).trim()
  const bankEn = (i.paymentInfoEn || i.paymentInfoBg).trim()

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; color: #2c2c2a; max-width: 520px; margin: 0 auto; padding: 24px;">
<p style="font-size: 15px; margin: 0 0 12px;">Здравейте,</p>
${htmlSection(bg, i, bankBg)}
<hr style="border: 0; border-top: 1px solid #ece9e1; margin: 24px 0;">
<p style="font-size: 15px; margin: 0 0 12px;">Hello,</p>
${htmlSection(en, i, bankEn)}
</div>`

  const text = `Здравейте,\n\n${textSection(bg, i, bankBg)}\n\n---\n\nHello,\n\n${textSection(en, i, bankEn)}\n`

  return { subject: bg.subject, html, text }
}
