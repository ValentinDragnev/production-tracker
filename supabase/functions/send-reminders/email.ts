// Reminder email text and HTML. No imports, so it runs both in the Supabase
// function (Deno) and in the app's unit tests (Node).

export type ReminderKind = 'week' | 'day' | 'ended'

export interface ReminderInput {
  kind: ReminderKind
  isTrial: boolean
  businessName: string
  periodEnd: string | Date
  monthlyPrice: number | null
  yearlyPrice: number | null
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
  prices: string
  payRevolut: string
  reference: string
  orBank: string
  openApp: string
  questions: string
}

function bulgarian(i: ReminderInput): Wording {
  const date = formatDay(i.periodEnd, 'bg-BG')
  const what = i.isTrial ? 'Безплатният период' : 'Абонаментът'
  const prices = [
    i.monthlyPrice !== null ? `Месечно: ${money(i.monthlyPrice, i.currency, 'bg-BG')}` : '',
    i.yearlyPrice !== null ? `Годишно: ${money(i.yearlyPrice, i.currency, 'bg-BG')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    subject:
      i.kind === 'ended'
        ? i.isTrial
          ? 'Безплатният ви период приключи'
          : 'Абонаментът ви изтече'
        : `${i.isTrial ? 'Безплатният ви период' : 'Абонаментът ви'} изтича на ${date}`,
    lead:
      i.kind === 'ended'
        ? `${what} на ${i.businessName} в „Производство и брак“ приключи на ${date}. Отчетите ви остават достъпни, но за да въвеждате нови числа, подновете абонамента.`
        : `${what} на ${i.businessName} в „Производство и брак“ изтича на ${date}. За да продължите да въвеждате числа и след това, подновете абонамента.`,
    prices,
    payRevolut: 'Плати с Revolut',
    reference: `В основанието напишете: ${i.businessName}`,
    orBank: 'Или по банков път:',
    openApp: 'Отворете приложението',
    questions: i.contactEmail
      ? `Въпроси? Пишете ни на ${i.contactEmail} или просто отговорете на това писмо.`
      : 'Въпроси? Просто отговорете на това писмо.',
  }
}

function english(i: ReminderInput): Wording {
  const date = formatDay(i.periodEnd, 'en-GB')
  const what = i.isTrial ? 'free trial' : 'subscription'
  const prices = [
    i.monthlyPrice !== null ? `Monthly: ${money(i.monthlyPrice, i.currency, 'en-GB')}` : '',
    i.yearlyPrice !== null ? `Yearly: ${money(i.yearlyPrice, i.currency, 'en-GB')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    subject: i.kind === 'ended' ? `Your ${what} has ended` : `Your ${what} ends on ${date}`,
    lead:
      i.kind === 'ended'
        ? `The ${what} for ${i.businessName} in Production and waste ended on ${date}. Your reports are still there; to enter new numbers, renew the subscription.`
        : `The ${what} for ${i.businessName} in Production and waste ends on ${date}. To keep entering numbers after that, renew the subscription.`,
    prices,
    payRevolut: 'Pay with Revolut',
    reference: `As the payment note, write: ${i.businessName}`,
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
