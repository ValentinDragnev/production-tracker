import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  label: string
  /** Product name, so screen readers know which product this is for. */
  productName: string
  value: number
  onChange(value: number): void
  tone: 'produced' | 'wasted'
}

/** A big "− number +" control. The number can also be typed directly. */
export function Stepper({ label, productName, value, onChange, tone }: Props) {
  const { t } = useI18n()
  // Local text so the field can be empty while the user is typing.
  const [text, setText] = useState(String(value))

  // Follow outside changes (+/−, capping) but leave an in-progress edit alone.
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : String(value)))
  }, [value])

  const fullLabel = `${productName}, ${label}`

  return (
    <div className={`stepper stepper--${tone}`}>
      <span className="stepper__label">{label}</span>
      <div className="stepper__controls">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`${t('removeOne')}: ${fullLabel}`}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </button>
        <input
          className="stepper__input"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={fullLabel}
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setText(e.target.value.replace(/\D/g, ''))
            onChange(parse(e.target.value))
          }}
          // Every keystroke is already saved; on leaving, show the stored
          // value (empty becomes 0, too-high waste shows the capped number).
          onBlur={() => setText(String(value))}
        />
        <button
          type="button"
          className="stepper__btn stepper__btn--plus"
          aria-label={`${t('addOne')}: ${fullLabel}`}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  )
}

function parse(raw: string): number {
  const digits = raw.replace(/\D/g, '')
  return digits === '' ? 0 : Math.min(99999, parseInt(digits, 10))
}
