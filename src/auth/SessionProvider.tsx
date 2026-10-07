import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { amIAdmin, loadPriceSettings, loadSubscription, type PriceSettings } from '../data/billing'
import type { Role } from '../data/team'
import type { Subscription } from '../lib/subscription'

export interface BusinessMembership {
  id: string
  name: string
  role: Role
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'error' }
  | { status: 'needsBusiness'; email: string }
  | {
      status: 'ready'
      email: string
      business: BusinessMembership
      subscription: Subscription
      prices: PriceSettings
    }

interface SessionContextValue {
  state: SessionState
  client: SupabaseClient
  /** The platform owner, who gets the admin panel. */
  isAdmin: boolean
  signOut(): Promise<void>
  createBusiness(name: string): Promise<void>
  renameBusiness(name: string): Promise<void>
  /** Re-reads subscription and prices, e.g. after a save was refused. */
  refreshBilling(): Promise<void>
  retry(): void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ client, children }: { client: SupabaseClient; children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [client])

  const userId = session?.user.id
  const email = session?.user.email ?? ''

  // After login: join the business that invited us (if any), then load ours.
  // Each email belongs to at most one business; the database enforces it.
  const loadBusinesses = useCallback(async () => {
    if (!userId) return
    setState({ status: 'loading' })
    try {
      const invites = await client.rpc('accept_invites')
      if (invites.error) throw invites.error
      void amIAdmin(client).then(setIsAdmin)

      const { data, error } = await client
        .from('memberships')
        .select('role, businesses ( id, name )')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error

      const membership = data as unknown as { role: Role; businesses: { id: string; name: string } } | null
      if (!membership) {
        setState({ status: 'needsBusiness', email })
        return
      }
      const { id, name } = membership.businesses
      const [subscription, prices] = await Promise.all([loadSubscription(client, id), loadPriceSettings(client)])
      setState({ status: 'ready', email, business: { id, name, role: membership.role }, subscription, prices })
    } catch {
      setState({ status: 'error' })
    }
  }, [client, userId, email])

  // Keyed on the user, not the session object: hourly token refreshes hand
  // us a new session, and reloading then would wipe whatever is on screen.
  const signedIn = session === undefined ? undefined : session !== null
  useEffect(() => {
    if (signedIn === undefined) return
    if (!signedIn) {
      setState({ status: 'signedOut' })
      setIsAdmin(false)
      return
    }
    void loadBusinesses()
  }, [signedIn, loadBusinesses, attempt])

  const businessId = state.status === 'ready' ? state.business.id : null
  const refreshBilling = useCallback(async () => {
    if (!businessId) return
    try {
      const [subscription, prices] = await Promise.all([loadSubscription(client, businessId), loadPriceSettings(client)])
      setState((s) => (s.status === 'ready' && s.business.id === businessId ? { ...s, subscription, prices } : s))
    } catch {
      // Keep what we had; the next refresh will try again.
    }
  }, [client, businessId])

  // Pick up a payment (or a lock) when the app comes back to the foreground.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshBilling()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshBilling])

  const value: SessionContextValue = {
    state,
    client,
    isAdmin,
    refreshBilling,
    async signOut() {
      await client.auth.signOut()
    },
    async createBusiness(name) {
      const { error } = await client.rpc('create_business', { business_name: name })
      // Already in a business (e.g. invited meanwhile): just load that one.
      if (error && error.message !== 'already_in_business') throw error
      await loadBusinesses()
    },
    async renameBusiness(name) {
      if (state.status !== 'ready') return
      const { error } = await client.from('businesses').update({ name }).eq('id', state.business.id)
      if (error) throw error
      setState({ ...state, business: { ...state.business, name } })
    },
    retry() {
      setAttempt((a) => a + 1)
    },
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

/** Like useSession, but returns null in demo mode (no SessionProvider). */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext)
}
