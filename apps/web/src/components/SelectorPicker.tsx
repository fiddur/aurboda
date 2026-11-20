/**
 * Pick a correlation **selector** — a data dimension (a metric, a nutrient, a
 * meal sensitivity flag, or a regex over activities / productivity) that the correlation engine resolves to a
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
  people: 'time with people',
  sensitivity: 'meal sensitivity',
}

/** Every selector kind offered when either side may be continuous (e.g. article blocks). */
export const ALL_SELECTOR_KINDS: CorrelationSelector['kind'][] = [
  'metric',
  'activity',
  'nutrition',
  'productivity_category',
  'productivity_app',
  'sensitivity',
]

function SensitivityFlagSelect({
  flag,
  selectors,
  onChange,
}: {
  flag: string
  selectors: CorrelationSelectorsData | undefined
  onChange: (s: CorrelationSelector) => void
}) {
  return (
    <select
      value={flag}
      onChange={(e) => onChange({ flag: (e.target as HTMLSelectElement).value, kind: 'sensitivity' })}
    >
      {flag === '' && <option value="">pick a flag</option>}
      <optgroup label="Meal sensitivities">
        {selectors?.sensitivities.map((o) => (
          <option value={o.value}>{o.label}</option>
        ))}
      </optgroup>
    </select>
  )
}

type PatternSelector = Extract<CorrelationSelector, { pattern: string }>

const isPatternSelector = (selector: CorrelationSelector): selector is PatternSelector =>
  'pattern' in selector

const selectorForKind = (
  kind: CorrelationSelector['kind'],
  selectors: CorrelationSelectorsData | undefined,
): CorrelationSelector => {
  switch (kind) {
    case 'metric':
      return { kind: 'metric', metric: '' }
    case 'nutrition':
      return { kind: 'nutrition', nutrient: 'carbs' }
    case 'productivity_category':
    case 'productivity_app':
      return { kind, pattern: '' }
    case 'sensitivity':
      return { flag: selectors?.sensitivities[0]?.value ?? '', kind: 'sensitivity' }
    case 'people':
      return { kind: 'people' }
    default:
      return { kind: 'activity', pattern: '' }
  }
}

function PeopleSelect({
  personId,
  selectors,
  onChange,
}: {
  personId: string | undefined
  selectors: CorrelationSelectorsData | undefined
  onChange: (s: CorrelationSelector) => void
}) {
  const options = selectors?.people.length ? selectors.people : [{ label: 'Time with people', value: '' }]
  return (
    <select
      aria-label="With whom"
      value={personId ?? ''}
      onChange={(e) => {
        const picked = (e.target as HTMLSelectElement).value
        onChange(picked ? { kind: 'people', person_id: picked } : { kind: 'people' })
      }}
    >
      {options.map((o) => (
        <option value={o.value}>{o.value === '' ? 'with anyone' : o.label}</option>
      ))}
      {personId && !options.some((o) => o.value === personId) && (
        <option value={personId}>a person no longer listed</option>
      )}
    </select>
  )
}

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
  const setKind = (kind: CorrelationSelector['kind']) => onChange(selectorForKind(kind, selectors))

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

      {value.kind === 'sensitivity' && (
        <SensitivityFlagSelect flag={value.flag} selectors={selectors} onChange={onChange} />
      )}

      {value.kind === 'people' && (
        <PeopleSelect personId={value.person_id} selectors={selectors} onChange={onChange} />
      )}

      {isPatternSelector(value) && (
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
