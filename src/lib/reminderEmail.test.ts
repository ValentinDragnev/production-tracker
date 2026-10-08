import { describe, expect, it } from 'vitest'
import { renderReminder, type ReminderInput } from '../../supabase/functions/send-reminders/email'

const base: ReminderInput = {
  kind: 'week',
  isTrial: true,
  businessName: 'Пекарна „Слънце“',
  periodEnd: '2026-11-06T10:00:00Z',
  monthlyPrice: 15,
  yearlyPrice: 150,
  currency: 'EUR',
  revolutLink: 'https://revolut.me/valentwd7c',
  paymentInfoBg: 'IBAN BG00 TEST',
  paymentInfoEn: '',
  contactEmail: 'proizvodstvoibrak@gmail.com',
  appUrl: 'https://proizvodstvo.netlify.app',
}

describe('renderReminder', () => {
  it('announces the end date of a trial, in Bulgarian then English', () => {
    const mail = renderReminder(base)
    expect(mail.subject).toBe('Безплатният ви период изтича на 6 ноември 2026 г.')
    expect(mail.text).toContain('Безплатният период на Пекарна „Слънце“ в „Производство и брак“ изтича на 6 ноември 2026 г.')
    expect(mail.text).toContain('The free trial for Пекарна „Слънце“ in Production and waste ends on 6 November 2026.')
    expect(mail.text.indexOf('Здравейте')).toBeLessThan(mail.text.indexOf('Hello'))
  })

  it('includes prices, the Revolut link with a payment reference, bank details and contact', () => {
    const mail = renderReminder(base)
    // Currency formatting uses a non-breaking space before "€".
    expect(mail.text.replace(/\u00a0/g, ' ')).toContain('Месечно: 15,00 € · Годишно: 150,00 €')
    expect(mail.text).toContain('Плати с Revolut: https://revolut.me/valentwd7c')
    expect(mail.text).toContain('В основанието напишете: Пекарна „Слънце“')
    expect(mail.text).toContain('Или по банков път:\nIBAN BG00 TEST')
    expect(mail.text).toContain('proizvodstvoibrak@gmail.com')
    expect(mail.html).toContain('href="https://revolut.me/valentwd7c"')
    expect(mail.html).toContain('href="https://proizvodstvo.netlify.app"')
  })

  it('words an ended subscription differently', () => {
    const mail = renderReminder({ ...base, kind: 'ended', isTrial: false })
    expect(mail.subject).toBe('Абонаментът ви изтече')
    expect(mail.text).toContain('Отчетите ви остават достъпни')
    expect(mail.text).toContain('ended on 6 November 2026')
  })

  it('leaves out Revolut and bank sections that are not set', () => {
    const mail = renderReminder({ ...base, revolutLink: '', paymentInfoBg: '', paymentInfoEn: '' })
    expect(mail.text).not.toContain('Revolut')
    expect(mail.text).not.toContain('банков път')
  })

  it('escapes business names in the HTML', () => {
    const mail = renderReminder({ ...base, businessName: '<script>alert(1)</script>' })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
  })
})
