import { useState } from 'react'
import { useStore } from '../data/StoreProvider'
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
  const { store, groups, products, refresh, resetDemo } = useStore()
  const [addingGroup, setAddingGroup] = useState(false)

  const sortedGroups = sortByOrder(groups)

  const saveGroup = async (group: ProductGroup) => {
    await store.saveGroup(group)
    await refresh()
  }
  const saveProduct = async (product: Product) => {
    await store.saveProduct(product)
    await refresh()
  }

  /** Swap an item with its neighbour, renumbering the list so orders stay unique. */
  async function move<T extends { sortOrder: number; name: string }>(
    list: T[],
    index: number,
    delta: -1 | 1,
    saveItem: (item: T) => Promise<void>,
  ) {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const reordered = [...list]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    await Promise.all(reordered.map((item, i) => saveItem({ ...item, sortOrder: i + 1 })))
  }

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
                onMoveUp={gi > 0 ? () => move(sortedGroups, gi, -1, store.saveGroup.bind(store)).then(refresh) : undefined}
                onMoveDown={
                  gi < sortedGroups.length - 1
                    ? () => move(sortedGroups, gi, 1, store.saveGroup.bind(store)).then(refresh)
                    : undefined
                }
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
                  onMoveUp={
                    pi > 0 ? () => move(groupProducts, pi, -1, store.saveProduct.bind(store)).then(refresh) : undefined
                  }
                  onMoveDown={
                    pi < groupProducts.length - 1
                      ? () => move(groupProducts, pi, 1, store.saveProduct.bind(store)).then(refresh)
                      : undefined
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
    </div>
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

/** randomUUID only exists on secure origins; plain-http LAN testing needs a fallback. */
function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
