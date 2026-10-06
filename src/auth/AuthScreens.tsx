import type { AuthError } from '@supabase/supabase-js'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { looksLikeEmail, normalizeEmail } from '../data/team'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { useSession } from './SessionProvider'

const RESEND_AFTER_S = 60
// Supabase sends 6 digits once our config is pushed; 8 is its default.
const CODE_MIN = 6
const CODE_MAX = 8

export function LoginScreen() {
  const { t } = useI18n()
  const { client } = useSession()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await client.auth.signInWithOtp({
      email: normalizeEmail(email),
      // The email's login link brings people back here (temporary fallback
      // until the code email is enabled with custom SMTP).
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (err) {
      setError(authErrorKey(err))
      return false
    }
    setResendIn(RESEND_AFTER_S)
    return true
  }

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault()
    if (!looksLikeEmail(email)) {
      setError('emailInvalid')
      return
    }
    if (await sendCode()) {
      setCode('')
      setStep('code')
    }
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    if (code.length < CODE_MIN) {
      setError('codeInvalid')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await client.auth.verifyOtp({ email: normalizeEmail(email), token: code, type: 'email' })
    setBusy(false)
    // On success the session listener takes over and leaves this screen.
    if (err) setError(err.status === 429 ? 'tooManyAttempts' : isNetworkError(err) ? 'networkError' : 'codeInvalid')
  }

  if (step === 'email') {
    return (
      <AuthLayout title={t('loginTitle')} intro={t('loginIntro')}>
        <form onSubmit={submitEmail} noValidate>
          <label className="field">
            <span className="field__label">{t('email')}</span>
            <input
              className="field__input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('emailPlaceholder')}
              value={email}
              aria-invalid={error === 'emailInvalid'}
              onChange={(e) => {
                setEmail(e.target.value)
                setError(null)
              }}
            />
          </label>
          {error && <p className="field__error">{t(error)}</p>}
          <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={busy}>
            {busy ? t('sending') : t('sendCode')}
          </button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('codeTitle')} intro={t('codeIntro', { email: normalizeEmail(email) })}>
      <form onSubmit={submitCode} noValidate>
        <label className="field">
          <span className="field__label">{t('code')}</span>
          <input
            className="field__input auth__code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_MAX}
            placeholder="••••••"
            value={code}
            autoFocus
            aria-invalid={error === 'codeInvalid'}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_MAX))
              setError(null)
            }}
          />
        </label>
        {error && <p className="field__error">{t(error)}</p>}
        <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={busy}>
          {busy ? t('signingIn') : t('signIn')}
        </button>
      </form>
      <div className="auth__links">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setStep('email')
            setError(null)
          }}
        >
          {t('changeEmail')}
        </button>
        {resendIn > 0 ? (
          <span className="muted">{t('resendIn', { seconds: resendIn })}</span>
        ) : (
          <button type="button" className="link-btn" disabled={busy} onClick={() => void sendCode()}>
            {t('resendCode')}
          </button>
        )}
      </div>
    </AuthLayout>
  )
}

export function BusinessSetupScreen({ email }: { email: string }) {
  const { t } = useI18n()
  const { createBusiness, signOut } = useSession()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('nameRequired')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createBusiness(name.trim())
    } catch {
      setError('actionFailed')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('businessTitle')} intro={t('businessIntro')}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="field__label">{t('businessName')}</span>
          <input
            className="field__input"
            placeholder={t('businessPlaceholder')}
            maxLength={80}
            value={name}
            autoFocus
            aria-invalid={error === 'nameRequired'}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
          />
        </label>
        {error && <p className="field__error">{t(error)}</p>}
        <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={busy}>
          {t('start')}
        </button>
      </form>
      <p className="muted auth__note">{t('invitedHint', { email })}</p>
      <div className="auth__links">
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          {t('signOut')}
        </button>
      </div>
    </AuthLayout>
  )
}

export function StatusScreen({ kind }: { kind: 'loading' | 'error' }) {
  const { t } = useI18n()
  const { retry, signOut } = useSession()
  if (kind === 'loading') {
    return (
      <div className="auth" role="status">
        <p className="muted auth__loading">{t('loading')}</p>
      </div>
    )
  }
  return (
    <AuthLayout title={t('loadFailed')} intro={t('networkError')}>
      <button type="button" className="btn btn--primary btn--block" onClick={retry}>
        {t('tryAgain')}
      </button>
      <div className="auth__links">
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          {t('signOut')}
        </button>
      </div>
    </AuthLayout>
  )
}

function AuthLayout({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const { t, lang, setLang } = useI18n()
  return (
    <div className="auth">
      <div className="auth__top">
        <img src="/icon.svg" alt="" width="40" height="40" />
        <span className="auth__app">{t('appName')}</span>
        <button type="button" className="link-btn" onClick={() => setLang(lang === 'bg' ? 'en' : 'bg')}>
          {lang === 'bg' ? 'English' : 'Български'}
        </button>
      </div>
      <h1 className="auth__title">{title}</h1>
      <p className="auth__intro">{intro}</p>
      {children}
    </div>
  )
}

function authErrorKey(err: AuthError): MessageKey {
  if (err.status === 429) return 'tooManyAttempts'
  if (isNetworkError(err)) return 'networkError'
  return 'actionFailed'
}

function isNetworkError(err: AuthError): boolean {
  return err.name === 'AuthRetryableFetchError' || err.status === 0
}
