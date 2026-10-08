import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { allowsDecimals, cleanQuantityInput, formatQuantity, parseQuantity, roundQuantity, type Unit } from '../lib/units'
import { UNIT_SHORT } from './labels'

interface Props {
  label: string
  /** Product name, so screen readers know which product this is for. */
  productName: string
  value: number
  onChange(value: number): void
  tone: 'produced' | 'wasted' | 'neutral'
  unit?: Unit
  /** Read-only, e.g. when the subscription has ended. */
  disabled?: boolean
}

/** A big "− number +" control. The number can also be typed directly. */
export function Stepper({ label, productName, value, onChange, tone, unit = 'pcs', disabled = false }: Props) {
  const { t, locale } = useI18n()
  const show = (n: number) => formatQuantity(n, unit, locale)
  const parse = (raw: string) => parseQuantity(raw, unit)
  // Local text so the field can be empty (or "2,") while the user is typing.
  const [text, setText] = useState(show(value))

  // Follow outside changes (+/−, capping) but leave an in-progress edit alone.
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : show(value)))
    // `show` and `parse` only change with the unit or language, which re-mounts.
  }, [value])

  const fullLabel = `${productName}, ${label}`

  return (
    <div className={`stepper stepper--${tone}`}>
      <span className="stepper__label">
        {label}
        {unit !== 'pcs' && <span className="stepper__unit"> ({t(UNIT_SHORT[unit])})</span>}
      </span>
      <div className="stepper__controls">
        <button
          type="button"
          className="stepper__btn"
          disabled={disabled}
          aria-label={`${t('removeOne')}: ${fullLabel}`}
          onClick={() => onChange(roundQuantity(value - 1, unit))}
        >
          −
        </button>
        <input
          className="stepper__input"
          inputMode={allowsDecimals(unit) ? 'decimal' : 'numeric'}
          aria-label={fullLabel}
          readOnly={disabled}
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const cleaned = cleanQuantityInput(e.target.value, unit)
            setText(cleaned)
            onChange(parse(cleaned))
          }}
          // Every keystroke is already saved; on leaving, show the stored
          // value (empty becomes 0, too-high waste shows the capped number).
          onBlur={() => setText(show(value))}
        />
        <button
          type="button"
          className="stepper__btn stepper__btn--plus"
          disabled={disabled}
          aria-label={`${t('addOne')}: ${fullLabel}`}
          onClick={() => onChange(roundQuantity(value + 1, unit))}
        >
          +
        </button>
      </div>
    </div>
  )
}
