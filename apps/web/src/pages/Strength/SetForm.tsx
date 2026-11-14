import { useState } from 'preact/hooks'

import type { SetPrefill, SetRow } from './sessionModel'

import {
  fieldsFromSet,
  hasMeasure,
  SET_TYPES,
  type SetFields,
  setFromFields,
  WEIGHT_STEPS,
} from './formModel'
import { Stepper } from './Stepper'

const hasExtras = (f: SetFields): boolean =>
  [f.set_type, f.rpe, f.rir, f.distance, f.note].some((v) => v !== '' && v !== 'normal')

export const SetForm = ({
  idPrefix,
  initial,
  timed,
  submitLabel,
  weightStep,
  onWeightStepChange,
  onSubmit,
  onCancel,
  onDelete,
}: {
  idPrefix: string
  initial: SetRow | SetPrefill
  timed: boolean
  submitLabel: string
  weightStep: number
  onWeightStepChange?: (step: number) => void
  onSubmit: (set: SetRow) => void
  onCancel?: () => void
  onDelete?: () => void
}) => {
  const [fields, setFields] = useState<SetFields>(() => fieldsFromSet(initial))
  const [open, setOpen] = useState(() => hasExtras(fieldsFromSet(initial)))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (key: keyof SetFields) => (value: string) => setFields((f) => ({ ...f, [key]: value }))
  const input = (key: keyof SetFields) => (e: Event) => set(key)((e.target as HTMLInputElement).value)

  const submit = (e: Event) => {
    e.preventDefault()
    if (hasMeasure(fields)) onSubmit(setFromFields(fields))
  }

  return (
    <form class="strength-set-form" onSubmit={submit}>
      <div class="strength-set-form-main">
        <Stepper
          id={`${idPrefix}-weight`}
          label="Weight (kg)"
          value={fields.weight}
          step={weightStep}
          decimal
          onChange={set('weight')}
        />
        {timed ? (
          <Stepper
            id={`${idPrefix}-time`}
            label="Seconds"
            value={fields.time}
            step={5}
            onChange={set('time')}
          />
        ) : (
          <Stepper id={`${idPrefix}-reps`} label="Reps" value={fields.reps} step={1} onChange={set('reps')} />
        )}
      </div>
      {onWeightStepChange && (
        <label class="strength-step-choice">
          <span>Weight step</span>
          <select
            value={String(weightStep)}
            onChange={(e) => onWeightStepChange(Number((e.target as HTMLSelectElement).value))}
          >
            {WEIGHT_STEPS.map((s) => (
              <option key={s} value={String(s)}>
                {s} kg
              </option>
            ))}
          </select>
        </label>
      )}
      <details
        class="strength-set-extras"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Warmup, drop set, RPE or a note</summary>
        <div class="strength-set-extras-grid">
          <label>
            <span class="strength-field-label">Set type</span>
            <select value={fields.set_type} onChange={input('set_type')}>
              <option value="">—</option>
              {SET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span class="strength-field-label">RPE</span>
            <input type="text" inputMode="decimal" value={fields.rpe} onInput={input('rpe')} />
          </label>
          <label>
            <span class="strength-field-label">RIR</span>
            <input type="text" inputMode="numeric" value={fields.rir} onInput={input('rir')} />
          </label>
          {timed ? (
            <label>
              <span class="strength-field-label">Reps</span>
              <input type="text" inputMode="numeric" value={fields.reps} onInput={input('reps')} />
            </label>
          ) : (
            <label>
              <span class="strength-field-label">Time (s)</span>
              <input type="text" inputMode="numeric" value={fields.time} onInput={input('time')} />
            </label>
          )}
          <label>
            <span class="strength-field-label">Distance (m)</span>
            <input type="text" inputMode="decimal" value={fields.distance} onInput={input('distance')} />
          </label>
          <label class="strength-set-note">
            <span class="strength-field-label">Note</span>
            <input type="text" value={fields.note} onInput={input('note')} />
          </label>
        </div>
      </details>
      <button type="submit" class="btn-primary strength-wide-btn" disabled={!hasMeasure(fields)}>
        {submitLabel}
      </button>
      {(onCancel || onDelete) && (
        <div class="strength-row-actions">
          {onCancel && (
            <button type="button" class="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          {onDelete &&
            (confirmDelete ? (
              <>
                <button type="button" class="btn-danger" onClick={onDelete}>
                  Delete this set
                </button>
                <button type="button" class="btn-secondary" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" class="btn-secondary" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            ))}
        </div>
      )}
    </form>
  )
}
