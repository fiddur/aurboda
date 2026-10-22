/**
 * Pick a correlation **selector** — a data dimension (a metric, a nutrient, or a
 * regex over activities / productivity) that the correlation engine resolves to a
 * daily series. A kind dropdown plus the inputs for that kind, autocompleted from
 * the discovered `selectors`. Shared by the Correlations explorer and the article
 * composer's correlation blocks.
 */
import type { CorrelationSelector, CorrelationSelectorsData, NutrientKey } from '@aurboda/api-spec'

import './SelectorPicker.css'

const NUTRIENTS: NutrientKey[] = ['calories', 'protein', 'carbs', 'fat', 'fiber']

/** Human labels for selector kinds (the raw kind is opaque in a dropdown). */
const KIND_LABELS: Partial<Record<CorrelationSelector['kind'], string>> = {
  activity: 'activity / tag',
  productivity_app: 'productivity app',
  productivity_category: 'productivity category',
}

/** Every selector kind offered when either side may be continuous (e.g. article blocks). */
export const ALL_SELECTOR_KINDS: CorrelationSelector['kind'][] = [
  'metric',
  'activity',
  'nutrition',
  'productivity_category',
  'productivity_app',
]

export function SelectorPicker({
  value,
  onChange,
  selectors,
  allowedKinds,
}: {
  value: CorrelationSelector
  onChange: (s: CorrelationSelector) => void
  selectors: CorrelationSelectorsData | undefined
  allowedKinds: CorrelationSelector['kind'][]
}) {
  const setKind = (kind: CorrelationSelector['kind']) => {
    switch (kind) {
      case 'metric':
        return onChange({ kind: 'metric', metric: '' })
      case 'nutrition':
        return onChange({ kind: 'nutrition', nutrient: 'carbs' })
      case 'activity':
        return onChange({ kind: 'activity', pattern: '' })
      case 'productivity_category':
      case 'productivity_app':
        return onChange({ kind, pattern: '' })
      default:
        return onChange({ kind: 'activity', pattern: '' })
    }
  }

  return (
    <div class="selector-picker">
      <select
        value={value.kind}
        onChange={(e) => setKind((e.target as HTMLSelectElement).value as CorrelationSelector['kind'])}
      >
        {allowedKinds.map((k) => (
          <option value={k}>{KIND_LABELS[k] ?? k}</option>
        ))}
      </select>

      {value.kind === 'metric' && (
        <>
          <input
            list="selector-metric-options"
            placeholder="metric (e.g. sleep_score)"
            value={value.metric}
            onInput={(e) => onChange({ ...value, metric: (e.target as HTMLInputElement).value })}
          />
          <datalist id="selector-metric-options">
            {selectors?.metrics.map((m) => (
              <option value={m.value}>{m.label}</option>
            ))}
          </datalist>
        </>
      )}

      {value.kind === 'nutrition' && (
        <select
          value={value.nutrient}
          onChange={(e) =>
            onChange({ kind: 'nutrition', nutrient: (e.target as HTMLSelectElement).value as NutrientKey })
          }
        >
          {NUTRIENTS.map((n) => (
            <option value={n}>{n}</option>
          ))}
        </select>
      )}

      {(value.kind === 'tag' ||
        value.kind === 'activity' ||
        value.kind === 'productivity_category' ||
        value.kind === 'productivity_app') && (
        <>
          <input
            list={`selector-pattern-options-${value.kind}`}
            placeholder="pattern (regex)"
            value={value.pattern}
            onInput={(e) => onChange({ ...value, pattern: (e.target as HTMLInputElement).value })}
          />
          <datalist id={`selector-pattern-options-${value.kind}`}>
            {(value.kind === 'productivity_category'
              ? selectors?.productivity_categories
              : value.kind === 'tag'
                ? selectors?.tags
                : selectors?.activity_types
            )?.map((o) => (
              <option value={o.value}>{o.label}</option>
            ))}
          </datalist>
        </>
      )}
    </div>
  )
}
