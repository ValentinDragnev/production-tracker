import { lazy, Suspense, useEffect, useState } from 'react'
import { useOptionalSession } from './auth/SessionProvider'
import { useStore } from './data/StoreProvider'
import { useI18n } from './i18n/I18nProvider'
import type { MessageKey } from './i18n/messages'
import { ReportsScreen } from './screens/ReportsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TodayScreen } from './screens/TodayScreen'

type Tab = 'today' | 'reports' | 'settings' | 'admin'

const TABS: { id: Tab; label: MessageKey; icon: string }[] = [
  { id: 'today', label: 'tabToday', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { id: 'reports', label: 'tabReports', icon: 'M4 20V10M10 20V4M16 20v-8M22 20H2' },
  {
    id: 'settings',
    label: 'tabSettings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  },
]

// Only the platform owner opens it, so customers never download it.
const AdminScreen = lazy(() => import('./screens/AdminScreen').then((m) => ({ default: m.AdminScreen })))

const ADMIN_TAB = {
  id: 'admin' as const,
  label: 'tabAdmin' as const,
  icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
}

export function App() {
  const { t } = useI18n()
  const { loading, error, refresh } = useStore()
  const isAdmin = useOptionalSession()?.isAdmin ?? false
  const [tab, setTab] = useState<Tab>('today')
  // Where to scroll after switching tabs, e.g. "How to pay" → the subscription section.
  const [scrollTo, setScrollTo] = useState<string | null>(null)
  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS

  useEffect(() => {
    document.title = t('appName')
  }, [t])

  useEffect(() => {
    const target = scrollTo ? document.getElementById(scrollTo) : null
    if (target) target.scrollIntoView({ block: 'start' })
    else window.scrollTo(0, 0)
    setScrollTo(null)
    // Only on tab changes; scrollTo is set together with the tab.
  }, [tab])

  return (
    <div className="app">
      <main className="app__main">
        {error && (
          <div className="banner" role="alert">
            <span>{t('loadFailed')}</span>
            <button type="button" className="link-btn" onClick={() => void refresh()}>
              {t('tryAgain')}
            </button>
          </div>
        )}
        {!loading && tab === 'today' && (
          <TodayScreen
            onHowToPay={() => {
              setScrollTo('subscription')
              setTab('settings')
            }}
          />
        )}
        {!loading && tab === 'reports' && <ReportsScreen />}
        {!loading && tab === 'settings' && <SettingsScreen />}
        {tab === 'admin' && isAdmin && (
          <Suspense fallback={<p className="muted screen">{t('loading')}</p>}>
            <AdminScreen />
          </Suspense>
        )}
      </main>
      <nav className="tabbar">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tabbar__item${tab === item.id ? ' is-active' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={item.icon} />
            </svg>
            <span>{t(item.label)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
