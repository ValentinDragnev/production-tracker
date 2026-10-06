import { useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  email: string
  businessName: string
  /** Shown right after adding someone, to prompt the owner to send it. */
  justAdded: boolean
  onClose(): void
}

/**
 * The invite message for a staff member, with ways to send it: the phone's
 * share menu (Viber, WhatsApp, SMS…), copy, or email. The app itself sends
 * nothing; the owner sends it from their own phone.
 */
export function InvitePanel({ email, businessName, justAdded, onClose }: Props) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [shareFailed, setShareFailed] = useState(false)

  const message = t('inviteMessage', { business: businessName, url: window.location.origin, email })
  const canShare = typeof navigator.share === 'function' && !shareFailed
  const canCopy = typeof navigator.clipboard?.writeText === 'function'
  const mailto = `mailto:${email}?subject=${encodeURIComponent(t('inviteSubject'))}&body=${encodeURIComponent(message)}`

  const share = async () => {
    try {
      await navigator.share({ text: message })
    } catch (err) {
      // Closing the share menu isn't an error; anything else falls back to copy.
      if (!(err instanceof DOMException && err.name === 'AbortError')) setShareFailed(true)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="invite" role="region" aria-label={t('inviteFor', { email })}>
      <p className="invite__title">{justAdded ? t('inviteAdded', { email }) : t('inviteFor', { email })}</p>
      <p className="invite__message">{message}</p>
      <div className="invite__actions">
        {canShare && (
          <button type="button" className="btn btn--primary" onClick={() => void share()}>
            {t('sendInvite')}
          </button>
        )}
        {canCopy && (
          <button type="button" className={canShare ? 'btn btn--secondary' : 'btn btn--primary'} onClick={() => void copy()}>
            {copied ? `✓ ${t('copied')}` : t('copyText')}
          </button>
        )}
        <a className="btn btn--secondary invite__link" href={mailto}>
          {t('byEmail')}
        </a>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {canShare && <p className="muted invite__hint">{t('sendInviteHint')}</p>}
    </div>
  )
}
