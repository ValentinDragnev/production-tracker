import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOptionalSession } from '../auth/SessionProvider'
import { useStore } from '../data/StoreProvider'
import { Team, looksLikeEmail, type Invite, type Member } from '../data/team'
import type { Product, ProductGroup } from '../data/types'
import { useI18n } from '../i18n/I18nProvider'
import type { Lang } from '../i18n/messages'
import { sortByOrder } from '../lib/reports'

const LANGUAGES: { lang: Lang; label: string }[] = [
  { lang: 'bg', label: 'Български' },
  { lang: 'en', label: 'English' },
]

export function SettingsScreen() {
  const { t, lang, setLang } = useI18n()
  const { role, resetDemo } = useStore()
  const session = useOptionalSession()
  const ready = session?.state.status === 'ready' ? session.state : null
  const client = session?.client
  const businessId = ready?.business.id
  const team = useMemo(() => (client && businessId ? new Team(client, businessId) : null), [client, businessId])

  return (
    <div className="screen">
      <h1 className="screen__title">{t('tabSettings')}</h1>

      <section className="group">
        <h2 className="group__title">{t('language')}</h2>
        <div className="segmented">
          {LANGUAGES.map((l) => (
            <button
              key={l.lang}
              type="button"
              className={lang === l.lang ? 'is-active' : ''}
              aria-pressed={lang === l.lang}
              onClick={() => setLang(l.lang)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      {ready && session && (
        <section className="group">
          <h2 className="group__title">{t('business')}</h2>
          <div className="card">
            <div className="card__title">{ready.business.name}</div>
            <p className="muted">
              {t('yourRole', { role: t(ready.business.role === 'owner' ? 'roleOwner' : 'roleStaff') })}
            </p>
            {ready.businesses.length > 1 && (
              <label className="field">
                <span className="field__label">{t('switchBusiness')}</span>
                <select
                  className="field__input"
                  value={ready.business.id}
                  onChange={(e) => session.switchBusiness(e.target.value)}
                >
                  {ready.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>
      )}

      {role === 'owner' ? (
        <ProductsSection />
      ) : (
        <section className="group">
          <h2 className="group__title">{t('productsAndGroups')}</h2>
          <p className="muted">{t('staffProductsHint')}</p>
        </section>
      )}

      {ready && team && role === 'owner' && <TeamSection team={team} myEmail={ready.email} />}

      {ready && session && (
        <section className="group">
          <h2 className="group__title">{t('account')}</h2>
          <div className="card account">
            <span className="account__email">{ready.email}</span>
            <button type="button" className="btn btn--secondary" onClick={() => void session.signOut()}>
              {t('signOut')}
            </button>
          </div>
        </section>
      )}

      {resetDemo && (
        <section className="group">
          <div className="notice">
            <strong>{t('demoMode')}</strong>
            <p>{t('demoModeHint')}</p>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                if (window.confirm(t('resetConfirm'))) void resetDemo()
              }}
            >
              {t('resetDemo')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function ProductsSection() {
  const { t } = useI18n()
  const { store, groups, products, refresh } = useStore()
  const [addingGroup, setAddingGroup] = useState(false)

  const sortedGroups = sortByOrder(groups)

  // Runs a change, then reloads; tells the user if it didn't go through.
  const change = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      window.alert(t('actionFailed'))
    }
    await refresh()
  }
  const saveGroup = (group: ProductGroup) => change(() => store.saveGroup(group))
  const saveProduct = (product: Product) => change(() => store.saveProduct(product))

  /** Swap an item with its neighbour, renumbering the list so orders stay unique. */
  function move<T extends { sortOrder: number; name: string }>(
    list: T[],
    index: number,
    delta: -1 | 1,
    saveItem: (item: T) => Promise<void>,
  ) {
    const target = index + delta
    const reordered = [...list]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    return change(() => Promise.all(reordered.map((item, i) => saveItem({ ...item, sortOrder: i + 1 }))))
  }
  const saveGroupRaw = (g: ProductGroup) => store.saveGroup(g)
  const saveProductRaw = (p: Product) => store.saveProduct(p)

  return (
    <section className="group">
      <h2 className="group__title">{t('productsAndGroups')}</h2>
      <p className="muted">{t('hideHint')}</p>

      {sortedGroups.map((group, gi) => {
        const groupProducts = sortByOrder(products.filter((p) => p.groupId === group.id))
        return (
          <div key={group.id} className="card card--list settings-group">
            <EditableRow
              name={group.name}
              hidden={group.archived}
              strong
              label={t('groupName')}
              onSave={(name) => saveGroup({ ...group, name })}
              onToggleHidden={() => saveGroup({ ...group, archived: !group.archived })}
              onMoveUp={gi > 0 ? () => move(sortedGroups, gi, -1, saveGroupRaw) : undefined}
              onMoveDown={gi < sortedGroups.length - 1 ? () => move(sortedGroups, gi, 1, saveGroupRaw) : undefined}
            />
            {groupProducts.map((product, pi) => (
              <EditableRow
                key={product.id}
                name={product.name}
                hidden={product.archived}
                indent
                label={t('productName')}
                onSave={(name) => saveProduct({ ...product, name })}
                onToggleHidden={() => saveProduct({ ...product, archived: !product.archived })}
                onMoveUp={pi > 0 ? () => move(groupProducts, pi, -1, saveProductRaw) : undefined}
                onMoveDown={
                  pi < groupProducts.length - 1 ? () => move(groupProducts, pi, 1, saveProductRaw) : undefined
                }
              />
            ))}
            <AddButton
              label={t('addProduct')}
              fieldLabel={t('productName')}
              placeholder={t('productPlaceholder')}
              onAdd={(name) =>
                saveProduct({
                  id: newId(),
                  groupId: group.id,
                  name,
                  sortOrder: groupProducts.length + 1,
                  archived: false,
                })
              }
            />
          </div>
        )
      })}

      {addingGroup ? (
        <div className="card">
          <NameForm
            label={t('groupName')}
            placeholder={t('groupPlaceholder')}
            onCancel={() => setAddingGroup(false)}
            onSave={async (name) => {
              await saveGroup({ id: newId(), name, sortOrder: groups.length + 1, archived: false })
              setAddingGroup(false)
            }}
          />
        </div>
      ) : (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setAddingGroup(true)}>
          + {t('addGroup')}
        </button>
      )}
    </section>
  )
}

function TeamSection({ team, myEmail }: { team: Team; myEmail: string }) {
  const { t } = useI18n()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<'emailInvalid' | 'actionFailed' | null>(null)
  const [justInvited, setJustInvited] = useState(false)

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([team.members(), team.invites()])
      setMembers(m)
      setInvites(i)
    } catch {
      setError('actionFailed')
    }
  }, [team])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
      await load()
      return true
    } catch {
      setError('actionFailed')
      return false
    }
  }

  return (
    <section className="group">
      <h2 className="group__title">{t('staff')}</h2>
      <p className="muted">{t('staffHint')}</p>
      <div className="card card--list">
        {members?.map((m) => (
          <div key={m.userId} className="row">
            <div>
              <div className="row__name">{m.email}</div>
              <div className="row__detail">
                {t(m.role === 'owner' ? 'roleOwner' : 'roleStaff')}
                {m.email === myEmail && ` · ${t('you')}`}
              </div>
            </div>
            {m.role !== 'owner' && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  if (window.confirm(t('removeConfirm', { email: m.email }))) void run(() => team.removeMember(m.userId))
                }}
              >
                {t('remove')}
              </button>
            )}
          </div>
        ))}
        {invites.map((i) => (
          <div key={i.email} className="row">
            <div>
              <div className="row__name">{i.email}</div>
              <div className="row__detail">{t('invited')}</div>
            </div>
            <button type="button" className="btn btn--ghost" onClick={() => void run(() => team.cancelInvite(i.email))}>
              {t('remove')}
            </button>
          </div>
        ))}
        <form
          className="row-editor"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault()
            if (!looksLikeEmail(email)) {
              setError('emailInvalid')
              return
            }
            if (await run(() => team.invite(email))) {
              setEmail('')
              setJustInvited(true)
            }
          }}
        >
          <label className="field">
            <span className="field__label">{t('staffEmail')}</span>
            <input
              className="field__input"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('emailPlaceholder')}
              value={email}
              aria-invalid={error === 'emailInvalid'}
              onChange={(e) => {
                setEmail(e.target.value)
                setError(null)
                setJustInvited(false)
              }}
            />
          </label>
          {error && <p className="field__error">{t(error)}</p>}
          {justInvited && <p className="muted team__hint">{t('inviteHint')}</p>}
          <div className="name-form__actions">
            <button type="submit" className="btn btn--primary">
              + {t('invite')}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}

interface EditableRowProps {
  name: string
  hidden: boolean
  label: string
  strong?: boolean
  indent?: boolean
  onSave(name: string): Promise<void>
  onToggleHidden(): Promise<void>
  onMoveUp?: () => Promise<void>
  onMoveDown?: () => Promise<void>
}

/** A list row that opens into an editor when tapped. */
function EditableRow(props: EditableRowProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rowClass = `row row--button${props.indent ? ' row--indent' : ''}${props.hidden ? ' row--hidden' : ''}`

  if (!open) {
    return (
      <button type="button" className={rowClass} aria-expanded={false} onClick={() => setOpen(true)}>
        <span className={props.strong ? 'row__name row__name--strong' : 'row__name'}>{props.name}</span>
        <span className="row__meta">
          {props.hidden && <span className="tag">{t('hidden')}</span>}
          <span aria-hidden="true">✎</span>
        </span>
      </button>
    )
  }

  return (
    <div className={`row-editor${props.indent ? ' row--indent' : ''}`}>
      <NameForm
        label={props.label}
        initial={props.name}
        cancelLabel={t('close')}
        onCancel={() => setOpen(false)}
        onSave={async (name) => {
          await props.onSave(name)
          setOpen(false)
        }}
      />
      <div className="row-editor__actions">
        <button type="button" className="btn btn--secondary" onClick={() => void props.onToggleHidden()}>
          {props.hidden ? t('show') : t('hide')}
        </button>
        {props.onMoveUp && (
          <button type="button" className="btn btn--secondary" aria-label={t('moveUp')} onClick={() => void props.onMoveUp!()}>
            ↑
          </button>
        )}
        {props.onMoveDown && (
          <button
            type="button"
            className="btn btn--secondary"
            aria-label={t('moveDown')}
            onClick={() => void props.onMoveDown!()}
          >
            ↓
          </button>
        )}
      </div>
    </div>
  )
}

function AddButton(props: { label: string; fieldLabel: string; placeholder: string; onAdd(name: string): Promise<void> }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="row row--button row--add" onClick={() => setOpen(true)}>
        + {props.label}
      </button>
    )
  }
  return (
    <div className="row-editor row--indent">
      <NameForm
        label={props.fieldLabel}
        placeholder={props.placeholder}
        onCancel={() => setOpen(false)}
        onSave={async (name) => {
          await props.onAdd(name)
          setOpen(false)
        }}
      />
    </div>
  )
}

interface NameFormProps {
  label: string
  initial?: string
  placeholder?: string
  /** Defaults to "Cancel". */
  cancelLabel?: string
  onSave(name: string): Promise<void>
  onCancel(): void
}

function NameForm({ label, initial = '', placeholder, cancelLabel, onSave, onCancel }: NameFormProps) {
  const { t } = useI18n()
  const [name, setName] = useState(initial)
  const [error, setError] = useState(false)

  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) {
          setError(true)
          return
        }
        void onSave(trimmed)
      }}
    >
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          className="field__input"
          value={name}
          placeholder={placeholder}
          autoFocus
          maxLength={60}
          aria-invalid={error}
          onChange={(e) => {
            setName(e.target.value)
            setError(false)
          }}
        />
        {error && <span className="field__error">{t('nameRequired')}</span>}
      </label>
      <div className="name-form__actions">
        <button type="submit" className="btn btn--primary">
          {t('save')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {cancelLabel ?? t('cancel')}
        </button>
      </div>
    </form>
  )
}

/**
 * A v4 UUID. crypto.randomUUID only exists on secure origins, so plain-http
 * testing on a phone over Wi-Fi builds one from getRandomValues instead.
 */
function newId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
