import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaidTier, Subscription } from '../lib/subscription'

/** Monthly and yearly price per paid plan; null when not offered. */
export interface PriceSettings {
  standardMonthly: number | null
  standardYearly: number | null
  unlimitedMonthly: number | null
  unlimitedYearly: number | null
  currency: string
  paymentInfoBg: string
  paymentInfoEn: string
  /** Revolut payment link (revolut.me/...), or '' when not offered. */
  revolutLink: string
  /** Where customers can write to; '' if not set. */
  contactEmail: string
}

export async function loadSubscription(client: SupabaseClient, businessId: string): Promise<Subscription> {
  const { data, error } = await client
    .from('subscriptions')
    .select('trial_ends_at, paid_until, plan, tier, locked')
    .eq('business_id', businessId)
    .single()
  if (error) throw error
  return { trialEndsAt: data.trial_ends_at, paidUntil: data.paid_until, plan: data.plan, tier: data.tier, locked: data.locked }
}

export async function loadPriceSettings(client: SupabaseClient): Promise<PriceSettings> {
  const { data, error } = await client
    .from('app_settings')
    .select(
      'standard_monthly, standard_yearly, unlimited_monthly, unlimited_yearly, currency, payment_info_bg, payment_info_en, revolut_link, contact_email',
    )
    .single()
  if (error) throw error
  return {
    standardMonthly: toNumber(data.standard_monthly),
    standardYearly: toNumber(data.standard_yearly),
    unlimitedMonthly: toNumber(data.unlimited_monthly),
    unlimitedYearly: toNumber(data.unlimited_yearly),
    currency: data.currency,
    paymentInfoBg: data.payment_info_bg,
    paymentInfoEn: data.payment_info_en,
    revolutLink: data.revolut_link,
    contactEmail: data.contact_email,
  }
}

export async function amIAdmin(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('am_i_admin')
  if (error) return false
  return data === true
}

// --- Admin -----------------------------------------------------------------

export type PaymentMethod = 'bank' | 'revolut' | 'card' | 'cash' | 'other'

export interface Customer {
  businessId: string
  businessName: string
  createdAt: string
  ownerEmail: string | null
  staffCount: number
  subscription: Subscription
  productsCount: number
  lastEntryAt: string | null
  daysEnteredLast7: number
  totalPaid: number
  phone: string | null
  notes: string | null
}

export interface Payment {
  id: string
  tier: PaidTier | null
  amount: number
  currency: string
  paidOn: string
  months: number
  method: PaymentMethod
  note: string | null
  coversFrom: string
  coversUntil: string
}

interface CustomerRow {
  business_id: string
  business_name: string
  created_at: string
  owner_email: string | null
  staff_count: number
  trial_ends_at: string
  paid_until: string | null
  plan: 'monthly' | 'yearly' | null
  tier: PaidTier | null
  locked: boolean
  products_count: number
  last_entry_at: string | null
  days_entered_last_7: number
  total_paid: number | string
  phone: string | null
  notes: string | null
}

interface PaymentRow {
  id: string
  tier: PaidTier | null
  amount: number | string
  currency: string
  paid_on: string
  months: number
  method: PaymentMethod
  note: string | null
  covers_from: string
  covers_until: string
}

/** The platform owner's tools. Every call is checked again in the database. */
export class Admin {
  constructor(private readonly client: SupabaseClient) {}

  async customers(): Promise<Customer[]> {
    const { data, error } = await this.client.rpc('admin_customers')
    if (error) throw error
    return (data as CustomerRow[]).map((r) => ({
      businessId: r.business_id,
      businessName: r.business_name,
      createdAt: r.created_at,
      ownerEmail: r.owner_email,
      staffCount: r.staff_count,
      subscription: { trialEndsAt: r.trial_ends_at, paidUntil: r.paid_until, plan: r.plan, tier: r.tier, locked: r.locked },
      productsCount: r.products_count,
      lastEntryAt: r.last_entry_at,
      daysEnteredLast7: r.days_entered_last_7,
      totalPaid: toNumber(r.total_paid) ?? 0,
      phone: r.phone,
      notes: r.notes,
    }))
  }

  async payments(businessId: string): Promise<Payment[]> {
    const { data, error } = await this.client.rpc('admin_payments', { bid: businessId })
    if (error) throw error
    return (data as PaymentRow[]).map((p) => ({
      id: p.id,
      tier: p.tier,
      amount: toNumber(p.amount) ?? 0,
      currency: p.currency,
      paidOn: p.paid_on,
      months: p.months,
      method: p.method,
      note: p.note,
      coversFrom: p.covers_from,
      coversUntil: p.covers_until,
    }))
  }

  async recordPayment(p: {
    businessId: string
    tier: PaidTier
    amount: number
    months: number
    method: PaymentMethod
    paidOn: string
    note: string
  }): Promise<void> {
    const { error } = await this.client.rpc('admin_record_payment', {
      bid: p.businessId,
      tier: p.tier,
      amount: p.amount,
      months: p.months,
      method: p.method,
      paid_on: p.paidOn,
      note: p.note,
    })
    if (error) throw error
  }

  async deletePayment(paymentId: string): Promise<void> {
    const { error } = await this.client.rpc('admin_delete_payment', { payment_id: paymentId })
    if (error) throw error
  }

  async setTrialEnd(businessId: string, endsAt: Date): Promise<void> {
    const { error } = await this.client.rpc('admin_set_trial_end', { bid: businessId, ends_at: endsAt.toISOString() })
    if (error) throw error
  }

  async setLocked(businessId: string, locked: boolean): Promise<void> {
    const { error } = await this.client.rpc('admin_set_locked', { bid: businessId, is_locked: locked })
    if (error) throw error
  }

  async saveNotes(businessId: string, phone: string, notes: string): Promise<void> {
    const { error } = await this.client.rpc('admin_save_notes', { bid: businessId, phone, notes })
    if (error) throw error
  }

  async saveSettings(s: PriceSettings): Promise<void> {
    const { error } = await this.client.rpc('admin_save_settings', {
      standard_monthly: s.standardMonthly,
      standard_yearly: s.standardYearly,
      unlimited_monthly: s.unlimitedMonthly,
      unlimited_yearly: s.unlimitedYearly,
      payment_info_bg: s.paymentInfoBg,
      payment_info_en: s.paymentInfoEn,
      revolut_link: s.revolutLink,
      contact_email: s.contactEmail,
    })
    if (error) throw error
  }
}

function toNumber(v: number | string | null): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
