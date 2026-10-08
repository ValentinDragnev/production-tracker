// Sends subscription reminder emails. Called once a day by a scheduled job
// (see the subscription_reminders migration); safe to call more often,
// because the database hands out each reminder only once.
//
// Secrets (set with `supabase secrets set`):
//   SMTP_PASSWORD  Gmail app password of the sending account (required)
//   SMTP_USER      sending account, default proizvodstvoibrak@gmail.com
//   APP_URL        link in the email, default https://proizvodstvo.netlify.app

import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6'
import { renderReminder, type ReminderKind } from './email.ts'

interface DueReminder {
  log_id: string
  business_id: string
  business_name: string
  owner_emails: string[]
  kind: ReminderKind
  period_end: string
  is_trial: boolean
  tier: 'standard' | 'unlimited' | null
}

const num = (v: number | string | null) => (v === null ? null : Number(v))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405)

  const password = Deno.env.get('SMTP_PASSWORD')
  if (!password) {
    console.error('SMTP_PASSWORD is not set')
    return json({ ok: false }, 500)
  }
  const smtpUser = Deno.env.get('SMTP_USER') ?? 'proizvodstvoibrak@gmail.com'
  const appUrl = Deno.env.get('APP_URL') ?? 'https://proizvodstvo.netlify.app'

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: due, error } = await db.rpc('claim_due_reminders')
  if (error) {
    console.error('claim_due_reminders failed', error)
    return json({ ok: false }, 500)
  }
  const reminders = (due ?? []) as DueReminder[]
  if (reminders.length === 0) return json({ ok: true })

  const { data: settings, error: settingsError } = await db
    .from('app_settings')
    .select(
      'standard_monthly, standard_yearly, unlimited_monthly, unlimited_yearly, currency, payment_info_bg, payment_info_en, revolut_link, contact_email',
    )
    .single()
  if (settingsError) {
    // Give the reminders back so tomorrow's run tries again.
    await Promise.all(reminders.map((r) => db.rpc('release_reminder', { log_id: r.log_id })))
    console.error('app_settings failed', settingsError)
    return json({ ok: false }, 500)
  }

  // Port 465 (TLS): Supabase functions can't open the usual 587.
  const mailer = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: smtpUser, pass: password },
  })

  let sent = 0
  for (const r of reminders) {
    if (r.owner_emails.length === 0) continue
    const mail = renderReminder({
      kind: r.kind,
      isTrial: r.is_trial,
      tier: r.tier,
      businessName: r.business_name,
      periodEnd: r.period_end,
      standardMonthly: num(settings.standard_monthly),
      standardYearly: num(settings.standard_yearly),
      unlimitedMonthly: num(settings.unlimited_monthly),
      unlimitedYearly: num(settings.unlimited_yearly),
      currency: settings.currency,
      revolutLink: settings.revolut_link,
      paymentInfoBg: settings.payment_info_bg,
      paymentInfoEn: settings.payment_info_en,
      contactEmail: settings.contact_email,
      appUrl,
    })
    try {
      await mailer.sendMail({
        from: { name: 'Производство и брак', address: smtpUser },
        to: r.owner_emails,
        replyTo: settings.contact_email || smtpUser,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })
      sent++
    } catch (e) {
      console.error(`sending to business ${r.business_id} failed`, e)
      await db.rpc('release_reminder', { log_id: r.log_id })
    }
  }

  console.log(`reminders: ${sent} sent of ${reminders.length} due`)
  // Counts stay in the logs: anyone can call this, so it reveals nothing.
  return json({ ok: true })
})
