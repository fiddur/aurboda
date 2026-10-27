import type { ActivityFeatures } from '@aurboda/api-spec'

import { useState } from 'preact/hooks'

import {
  addCategory,
  normalizeCategoryName,
  removeCategory,
  type RunCategoryChanges,
  runCategories,
} from './runCategories'
import { runFeatureRows } from './runFeatures'

export const RunCategories = ({
  data,
  onChange,
  disabled,
}: {
  data: Record<string, unknown> | undefined
  onChange: (changes: RunCategoryChanges) => void
  disabled?: boolean
}) => {
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState(false)
  const categories = runCategories(data)

  const submit = () => {
    const name = normalizeCategoryName(input)
    if (!name) {
      setInvalid(true)
      return
    }
    setInput('')
    setInvalid(false)
    onChange(addCategory(data, name))
  }

  return (
    <div class="run-categories">
      <div class="run-category-chips">
        {categories.map((c) => (
          <span
            key={c.category}
            class={`run-category-chip${c.rule_id ? '' : ' manual'}`}
            title={c.reasons.join('\n')}
          >
            {c.category.replaceAll('_', ' ')}
            {!disabled && (
              <button
                type="button"
                class="run-category-remove"
                aria-label={`Remove ${c.category}`}
                onClick={() => onChange(removeCategory(data, c.category))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            type="text"
            class={`run-category-input${invalid ? ' invalid' : ''}`}
            placeholder="Add category"
            aria-label="Add run category"
            value={input}
            onInput={(e) => {
              setInput((e.target as HTMLInputElement).value)
              setInvalid(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
          />
        )}
      </div>
      {categories.some((c) => c.reasons.length > 0) && (
        <details class="run-category-reasons">
          <summary>Why</summary>
          <ul>
            {categories
              .filter((c) => c.reasons.length > 0)
              .map((c) => (
                <li key={c.category}>
                  <strong>{c.category.replaceAll('_', ' ')}</strong>: {c.reasons.join('; ')}
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export const RunFeatures = ({ features }: { features: ActivityFeatures | undefined }) => {
  const rows = runFeatureRows(features)
  if (rows.length === 0) return null
  return (
    <details class="run-features">
      <summary>Run features</summary>
      <table class="activity-stats-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
