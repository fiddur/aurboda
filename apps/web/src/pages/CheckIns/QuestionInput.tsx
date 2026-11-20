import type { CheckInQuestion } from '@aurboda/api-spec'

import { type AnswerDraft, stepNumber } from './answers'

interface Props {
  question: CheckInQuestion
  value: AnswerDraft
  onChange: (value: AnswerDraft) => void
  /** Marks the question when a save was tried without its required answer. */
  missing?: boolean
  idPrefix: string
}

const range = (min: number, max: number): number[] => Array.from({ length: max - min + 1 }, (_, i) => min + i)

function Answer({ question, value, onChange, idPrefix }: Props) {
  switch (question.type) {
    case 'scale':
      return (
        <div class="checkin-scale">
          <div class="checkin-scale-buttons" role="radiogroup" aria-label={question.prompt}>
            {range(question.min, question.max).map((point) => (
              <button
                key={point}
                type="button"
                role="radio"
                aria-checked={value === point}
                class={`checkin-choice${value === point ? ' active' : ''}`}
                onClick={() => onChange(value === point ? undefined : point)}
              >
                {point}
              </button>
            ))}
          </div>
          {(question.min_label || question.max_label) && (
            <div class="checkin-scale-labels" aria-hidden="true">
              <span>{question.min_label}</span>
              <span>{question.max_label}</span>
            </div>
          )}
        </div>
      )
    case 'yes_no':
      return (
        <div class="checkin-options checkin-yes-no" role="radiogroup" aria-label={question.prompt}>
          {[
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={value === option.value}
              class={`checkin-choice${value === option.value ? ' active' : ''}`}
              onClick={() => onChange(value === option.value ? undefined : option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )
    case 'choice':
      return (
        <div class="checkin-options" role="radiogroup" aria-label={question.prompt}>
          {question.options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={value === option.key}
              class={`checkin-choice${value === option.key ? ' active' : ''}`}
              onClick={() => onChange(value === option.key ? undefined : option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )
    case 'multi_choice': {
      const picked = Array.isArray(value) ? value : []
      return (
        <div class="checkin-options" role="group" aria-label={question.prompt}>
          {question.options.map((option) => {
            const on = picked.includes(option.key)
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={on}
                class={`checkin-choice${on ? ' active' : ''}`}
                onClick={() =>
                  onChange(on ? picked.filter((key) => key !== option.key) : [...picked, option.key])
                }
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )
    }
    case 'number':
      return (
        <div class="checkin-number">
          <button
            type="button"
            class="checkin-stepper"
            aria-label="Less"
            onClick={() => onChange(stepNumber(question, value, -1))}
          >
            −
          </button>
          <input
            id={`${idPrefix}-${question.key}`}
            type="text"
            inputMode="decimal"
            value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
            aria-label={question.prompt}
            onInput={(e) => onChange(e.currentTarget.value)}
          />
          <button
            type="button"
            class="checkin-stepper"
            aria-label="More"
            onClick={() => onChange(stepNumber(question, value, 1))}
          >
            +
          </button>
          {question.unit && <span class="checkin-unit">{question.unit}</span>}
        </div>
      )
    case 'text':
      return (
        <textarea
          id={`${idPrefix}-${question.key}`}
          class="checkin-text"
          rows={3}
          maxLength={2000}
          value={typeof value === 'string' ? value : ''}
          aria-label={question.prompt}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      )
  }
}

const rangeHint = (question: CheckInQuestion): string | null => {
  if (question.type !== 'number') return null
  if (question.min !== undefined && question.max !== undefined) return `${question.min} to ${question.max}`
  if (question.min !== undefined) return `At least ${question.min}`
  if (question.max !== undefined) return `At most ${question.max}`
  return null
}

export function QuestionInput(props: Props) {
  const { question, missing } = props
  const hint = rangeHint(question)
  return (
    <div class={`checkin-question${missing ? ' missing' : ''}`}>
      <p class="checkin-prompt">
        {question.prompt}
        {question.required && (
          <span class="checkin-required" title="Required">
            {' '}
            *<span class="checkin-sr"> (required)</span>
          </span>
        )}
      </p>
      <Answer {...props} />
      {hint && <p class="checkin-hint">{hint}</p>}
      {missing && <p class="checkin-error">Please answer this one.</p>}
    </div>
  )
}
