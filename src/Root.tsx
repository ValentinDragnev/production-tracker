import type { SupabaseClient } from '@supabase/supabase-js'
import { useMemo, useState } from 'react'
import { App } from './App'
import { BusinessSetupScreen, LoginScreen, StatusScreen } from './auth/AuthScreens'
import { SessionProvider, useSession, type BusinessMembership } from './auth/SessionProvider'
import { LocalStore } from './data/localStore'
import { StoreProvider } from './data/StoreProvider'
import { supabase } from './data/supabase'
import { SupabaseStore } from './data/supabaseStore'

/** Real accounts when Supabase is configured; otherwise the sample-data demo. */
export function Root() {
  if (!supabase) return <DemoRoot />
  return (
    <SessionProvider client={supabase}>
      <SessionGate />
    </SessionProvider>
  )
}

function DemoRoot() {
  const [store] = useState(() => new LocalStore())
  return (
    <StoreProvider store={store} role="owner" demo onResetDemo={() => store.reset()}>
      <App />
    </StoreProvider>
  )
}

function SessionGate() {
  const { state, client } = useSession()
  switch (state.status) {
    case 'loading':
    case 'error':
      return <StatusScreen kind={state.status} />
    case 'signedOut':
      return <LoginScreen />
    case 'needsBusiness':
      return <BusinessSetupScreen email={state.email} />
    case 'ready':
      // Keyed so switching business starts every screen fresh.
      return <BusinessApp key={state.business.id} client={client} business={state.business} />
  }
}

function BusinessApp({ client, business }: { client: SupabaseClient; business: BusinessMembership }) {
  const store = useMemo(() => new SupabaseStore(client, business.id), [client, business.id])
  return (
    <StoreProvider store={store} role={business.role}>
      <App />
    </StoreProvider>
  )
}
