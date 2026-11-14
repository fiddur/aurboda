import { parseNumber, stepValue } from './formModel'

export const Stepper = ({
  id,
  label,
  value,
  step,
  decimal,
  onChange,
}: {
  id: string
  label: string
  value: string
  step: number
  decimal?: boolean
  onChange: (value: string) => void
}) => (
  <div class="strength-stepper">
    <label for={id} class="strength-field-label">
      {label}
    </label>
    <div class="strength-stepper-row">
      <button
        type="button"
        class="strength-stepper-btn"
        aria-label={`${label} minus ${step}`}
        onClick={() => onChange(stepValue(value, -step))}
        disabled={(parseNumber(value) ?? 0) <= 0}
      >
        −
      </button>
      <input
        id={id}
        class="strength-stepper-input"
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        autocomplete="off"
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      />
      <button
        type="button"
        class="strength-stepper-btn"
        aria-label={`${label} plus ${step}`}
        onClick={() => onChange(stepValue(value, step))}
      >
        +
      </button>
    </div>
  </div>
)
