import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '../data/team'

const BUSINESS_KEY = 'production-tracker:business'

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
  | { status: 'ready'; email: string; business: BusinessMembership; businesses: BusinessMembership[] }

interface SessionContextValue {
  state: SessionState
  client: SupabaseClient
  signOut(): Promise<void>
  createBusiness(name: string): Promise<void>
  switchBusiness(id: string): void
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

  // After login: join any businesses we were invited to, then load memberships.
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
        .order('created_at')
      if (error) throw error

      const businesses = (data as unknown as { role: Role; businesses: { id: string; name: string } }[]).map((m) => ({
        id: m.businesses.id,
        name: m.businesses.name,
        role: m.role,
      }))
      if (businesses.length === 0) {
        setState({ status: 'needsBusiness', email })
        return
      }
      const saved = readSavedBusiness()
      const business = businesses.find((b) => b.id === saved) ?? businesses[0]
      setState({ status: 'ready', email, business, businesses })
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
      saveBusiness(null)
      await client.auth.signOut()
    },
    async createBusiness(name) {
      const { data, error } = await client.rpc('create_business', { business_name: name })
      if (error) throw error
      saveBusiness(data as string)
      await loadBusinesses()
    },
    switchBusiness(id) {
      if (state.status !== 'ready') return
      const business = state.businesses.find((b) => b.id === id)
      if (!business) return
      saveBusiness(id)
      setState({ ...state, business })
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

function readSavedBusiness(): string | null {
  try {
    return localStorage.getItem(BUSINESS_KEY)
  } catch {
    return null
  }
}

function saveBusiness(id: string | null) {
  try {
    if (id) localStorage.setItem(BUSINESS_KEY, id)
    else localStorage.removeItem(BUSINESS_KEY)
  } catch {
    // Not remembered; the first business is used next time.
  }
}
