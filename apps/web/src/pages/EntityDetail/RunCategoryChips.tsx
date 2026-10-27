import type { ActivityFeatures } from '@aurboda/api-spec'

import { useState } from 'preact/hooks'

import { normalizeCategoryName } from '../../utils/runCategory'
import { addCategory, groupedRunCategories, removeCategory, type RunCategoryChanges } from './runCategories'
import { runFeatureRows } from './runFeatures'

const label = (category: string) => category.replaceAll('_', ' ')

export const RunCategories = ({
  data,
  onChange,
  readOnly,
  busy,
  error,
}: {
  data: Record<string, unknown> | undefined
  onChange: (changes: RunCategoryChanges) => void
  /** No editing at all (a deleted activity). */
  readOnly?: boolean
  /** A save or refetch is in flight: the controls stay visible but disabled. */
  busy?: boolean
  error?: string
}) => {
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState(false)
  const groups = groupedRunCategories(data)

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
        {groups.map((g) => (
          <span
            key={g.category}
            class={`run-category-chip${g.from_rule ? '' : ' manual'}`}
            title={g.reasons.join('\n')}
          >
            {label(g.category)}
            {!readOnly && (
              <button
                type="button"
                class="run-category-remove"
                aria-label={`Remove ${g.category}`}
                disabled={busy}
                onClick={() => onChange(removeCategory(data, g.category))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            type="text"
            class={`run-category-input${invalid ? ' invalid' : ''}`}
            placeholder="Add category"
            aria-label="Add run category"
            value={input}
            disabled={busy}
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
      {invalid && <p class="run-category-error">Use letters, digits and _, starting with a letter.</p>}
      {error && <p class="run-category-error">Saving the categories failed: {error}</p>}
      {groups.some((g) => g.reasons.length > 0) && (
        <details class="run-category-reasons">
          <summary>Why</summary>
          <ul>
            {groups
              .filter((g) => g.reasons.length > 0)
              .map((g) => (
                <li key={g.category}>
                  <strong>{label(g.category)}</strong>: {g.reasons.join('; ')}
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
