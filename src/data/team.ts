import type { SupabaseClient } from '@supabase/supabase-js'

export type Role = 'owner' | 'staff'

export interface Member {
  userId: string
  email: string
  role: Role
}

export interface Invite {
  email: string
}

/** Staff management for owners. Row-level security limits all of this to owners. */
export class Team {
  constructor(
    private readonly client: SupabaseClient,
    private readonly businessId: string,
  ) {}

  async members(): Promise<Member[]> {
    const { data, error } = await this.client
      .from('memberships')
      .select('user_id, email, role')
      .eq('business_id', this.businessId)
      .order('created_at')
    if (error) throw error
    return (data as { user_id: string; email: string; role: Role }[]).map((m) => ({
      userId: m.user_id,
      email: m.email,
      role: m.role,
    }))
  }

  async invites(): Promise<Invite[]> {
    const { data, error } = await this.client
      .from('invites')
      .select('email')
      .eq('business_id', this.businessId)
      .order('created_at')
    if (error) throw error
    return data as Invite[]
  }

  async invite(email: string): Promise<void> {
    const { error } = await this.client
      .from('invites')
      .insert({ business_id: this.businessId, email: normalizeEmail(email), role: 'staff' })
    // Already invited is fine: there's no update policy, so no upsert.
    if (error && error.code !== '23505') throw error
  }

  async cancelInvite(email: string): Promise<void> {
    const { error } = await this.client.from('invites').delete().eq('business_id', this.businessId).eq('email', email)
    if (error) throw error
  }

  async removeMember(userId: string): Promise<void> {
    const { error } = await this.client
      .from('memberships')
      .delete()
      .eq('business_id', this.businessId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}
