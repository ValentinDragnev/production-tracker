import type { SupabaseClient } from '@supabase/supabase-js'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useI18n } from './i18n/I18nProvider'
import { App } from './App'
import { BusinessSetupScreen, LoginScreen, StatusScreen } from './auth/AuthScreens'
import { SessionProvider, useSession, type BusinessMembership } from './auth/SessionProvider'
import { canEnterNumbers, limitsFor, PLAN_LIMITS, planState, type Subscription } from './lib/subscription'
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
  const { state, client, isAdmin } = useSession()
  const [adminOnly, setAdminOnly] = useState(false)
  // An admin without a business of their own still gets the admin panel.
  if (adminOnly && isAdmin && state.status === 'needsBusiness') return <StandaloneAdmin onBack={() => setAdminOnly(false)} />
  switch (state.status) {
    case 'loading':
    case 'error':
      return <StatusScreen kind={state.status} />
    case 'signedOut':
      return <LoginScreen />
    case 'needsBusiness':
      return <BusinessSetupScreen email={state.email} onOpenAdmin={isAdmin ? () => setAdminOnly(true) : undefined} />
    case 'ready':
      // Keyed so switching business starts every screen fresh.
      return (
        <BusinessApp
          key={state.business.id}
          client={client}
          business={state.business}
          staffRank={state.staffRank}
          subscription={state.subscription}
        />
      )
  }
}

const AdminScreen = lazy(() => import('./screens/AdminScreen').then((m) => ({ default: m.AdminScreen })))

function StandaloneAdmin({ onBack }: { onBack(): void }) {
  const { t } = useI18n()
  return (
    <div className="app__main">
      <button type="button" className="link-btn admin__back admin__back--top" onClick={onBack}>
        ‹ {t('back')}
      </button>
      <Suspense fallback={<p className="muted screen">{t('loading')}</p>}>
        <AdminScreen />
      </Suspense>
    </div>
  )
}

function BusinessApp(props: {
  client: SupabaseClient
  business: BusinessMembership
  staffRank: number | null
  subscription: Subscription | null
}) {
  const { client, business } = props
  const { refreshBilling } = useSession()
  const store = useMemo(() => new SupabaseStore(client, business.id), [client, business.id])
  // Unknown subscription: let them try; the database has the final say.
  const plan = props.subscription ? planState(props.subscription) : null
  const limits = plan ? limitsFor(plan) : PLAN_LIMITS.unlimited
  const staffBlocked =
    business.role === 'staff' && limits.staff !== null && props.staffRank !== null && props.staffRank > limits.staff
  const canEdit = (plan ? canEnterNumbers(plan) : true) && !staffBlocked
  return (
    <StoreProvider
      store={store}
      role={business.role}
      canEdit={canEdit}
      staffBlocked={staffBlocked}
      limits={limits}
      onRecheckAccess={() => void refreshBilling()}
    >
      <App />
    </StoreProvider>
  )
}
