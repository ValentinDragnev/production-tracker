import { useEffect, useState } from 'react'
import { useStore } from './data/StoreProvider'
import { useI18n } from './i18n/I18nProvider'
import type { MessageKey } from './i18n/messages'
import { ReportsScreen } from './screens/ReportsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TodayScreen } from './screens/TodayScreen'

type Tab = 'today' | 'reports' | 'settings'

const TABS: { id: Tab; label: MessageKey; icon: string }[] = [
  { id: 'today', label: 'tabToday', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { id: 'reports', label: 'tabReports', icon: 'M4 20V10M10 20V4M16 20v-8M22 20H2' },
  {
    id: 'settings',
    label: 'tabSettings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  },
]

export function App() {
  const { t } = useI18n()
  const { loading, error, refresh } = useStore()
  const [tab, setTab] = useState<Tab>('today')

  useEffect(() => {
    document.title = t('appName')
  }, [t])

  useEffect(() => {
    window.scrollTo(0, 0)
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
        {!loading && tab === 'today' && <TodayScreen />}
        {!loading && tab === 'reports' && <ReportsScreen />}
        {!loading && tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabbar">
        {TABS.map((item) => (
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
