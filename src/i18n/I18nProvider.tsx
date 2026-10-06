import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LOCALES, messages, type Lang, type MessageKey } from './messages'

const LANG_KEY = 'production-tracker:lang'

interface I18n {
  lang: Lang
  locale: string
  setLang(lang: Lang): void
  t(key: MessageKey, params?: Record<string, string | number>): string
  formatNumber(n: number): string
}

const I18nContext = createContext<I18n | null>(null)

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'bg' || saved === 'en') return saved
  } catch {
    // Storage blocked: fall back to Bulgarian.
  }
  return 'bg'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const locale = LOCALES[lang]

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      // Not remembered, but still switches for this visit.
    }
  }, [])

  const value = useMemo<I18n>(() => {
    const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    const formatNumber = (n: number) => numberFormat.format(n)
    return {
      lang,
      locale,
      setLang,
      formatNumber,
      t(key, params) {
        let text = messages[lang][key]
        for (const [name, v] of Object.entries(params ?? {})) {
          text = text.replaceAll(`{${name}}`, typeof v === 'number' ? formatNumber(v) : v)
        }
        return text
      },
    }
  }, [lang, locale, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
