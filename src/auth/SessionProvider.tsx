import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '../data/team'

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
  | { status: 'ready'; email: string; business: BusinessMembership }

interface SessionContextValue {
  state: SessionState
  client: SupabaseClient
  signOut(): Promise<void>
  createBusiness(name: string): Promise<void>
  renameBusiness(name: string): Promise<void>
  retry(): void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ client, children }: { client: SupabaseClient; children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

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
      setState({ status: 'ready', email, business: { id, name, role: membership.role } })
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
      return
    }
    void loadBusinesses()
  }, [signedIn, loadBusinesses, attempt])

  const value: SessionContextValue = {
    state,
    client,
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
