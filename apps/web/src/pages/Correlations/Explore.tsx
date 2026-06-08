import type {
  ContinuousCorrelationData,
  CorrelationSelector,
  CorrelationSelectorsData,
  EventOutcome,
  GenericCorrelationData,
  LagExposureResultData,
  NutrientKey,
  TriggerCondition,
} from '@aurboda/api-spec'

import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'

import {
  fetchContinuousCorrelation,
  fetchCorrelationSelectors,
  fetchGenericCorrelation,
} from '../../state/api'

type Mode = 'event' | 'continuous'

// --- Form state (module signals, mirroring the rest of this page) ---
const mode = signal<Mode>('event')
const triggerSelector = signal<CorrelationSelector>({ kind: 'tag', pattern: '' })
const outcomeSelector = signal<CorrelationSelector>({ kind: 'metric', metric: '' })
const eventOutcomeSource = signal<'metric' | 'tag'>('metric')
const eventOutcomeValue = signal('')
const lagWindowsInput = signal('24h,48h,7d')
const lagDaysInput = signal(0)
const collapseGapDays = signal(3)
const denominator = signal<'known' | 'all'>('known')
const periodStart = signal('')
const periodEnd = signal('')
const periodDays = signal(365)
// Bumped on each Run to trigger the query.
const runToken = signal(0)

const NUTRIENTS: NutrientKey[] = ['calories', 'protein', 'carbs', 'fat', 'fiber']

// Trigger kinds allowed per mode (event mode has no metric trigger).
const EVENT_TRIGGER_KINDS: CorrelationSelector['kind'][] = [
  'tag',
  'activity',
  'nutrition',
  'productivity_category',
  'productivity_app',
]

/** Switch mode, clamping the trigger to a kind valid in the new mode. */
const setMode = (next: Mode) => {
  mode.value = next
  if (next === 'event' && !EVENT_TRIGGER_KINDS.includes(triggerSelector.value.kind)) {
    triggerSelector.value = { kind: 'tag', pattern: '' }
  }
}

const parseLagWindows = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const fmt = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined ? '—' : value.toFixed(digits)

const fmtPct = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(0)}%`

/** Build the request body for whichever mode is active. */
const buildRequest = () => {
  if (mode.value === 'event') {
    const trigger = triggerSelector.value
    const triggerCondition: TriggerCondition =
      trigger.kind === 'nutrition'
        ? { nutrient: trigger.nutrient, type: 'nutrition' }
        : trigger.kind === 'metric'
          ? { pattern: '', type: 'tag' } // metric not valid as a trigger; fall back to empty tag
          : {
              pattern: 'pattern' in trigger ? trigger.pattern : '',
              type: trigger.kind === 'activity' ? 'activity' : (trigger.kind as TriggerCondition['type']),
            }
    const outcome: EventOutcome =
      eventOutcomeSource.value === 'metric'
        ? { metric: eventOutcomeValue.value, source: 'metric', type: 'event' }
        : { pattern: eventOutcomeValue.value, source: 'tag', type: 'event' }
    return { outcome, triggerCondition }
  }
  return null
}

// --- Selector picker (kind + value) ---
function SelectorPicker({
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
        return onChange({ kind: 'tag', pattern: '' })
    }
  }

  return (
    <div class="selector-picker">
      <select
        value={value.kind}
        onChange={(e) => setKind((e.target as HTMLSelectElement).value as CorrelationSelector['kind'])}
      >
        {allowedKinds.map((k) => (
          <option value={k}>{k}</option>
        ))}
      </select>

      {value.kind === 'metric' && (
        <>
          <input
            list="metric-options"
            placeholder="metric (e.g. sleep_score)"
            value={value.metric}
            onInput={(e) => onChange({ ...value, metric: (e.target as HTMLInputElement).value })}
          />
          <datalist id="metric-options">
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
            list={`pattern-options-${value.kind}`}
            placeholder="pattern (regex)"
            value={value.pattern}
            onInput={(e) => onChange({ ...value, pattern: (e.target as HTMLInputElement).value })}
          />
          <datalist id={`pattern-options-${value.kind}`}>
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

// --- Results: event-outcome table ---
function EventOutcomeResults({ data }: { data: GenericCorrelationData }) {
  const eo = data.event_outcome
  if (!eo) return <p class="explore-empty">No event-outcome result.</p>

  const significant = (lag: LagExposureResultData) => lag.p_value < 0.05

  return (
    <div class="explore-results">
      <p class="explore-summary">
        {eo.onsets} onsets (from {eo.outcome_days} event days) · {eo.trigger_days} trigger days ·{' '}
        {eo.known_days} known days · denominator: {eo.denominator}
      </p>
      <div class="table-container">
        <table class="correlations-table">
          <thead>
            <tr>
              <th>Lag</th>
              <th>P(trigger | onset)</th>
              <th>Base rate</th>
              <th>Rel. risk (95% CI)</th>
              <th>p</th>
              <th>Onsets exposed</th>
            </tr>
          </thead>
          <tbody>
            {eo.per_lag.map((lag) => (
              <tr class={significant(lag) ? 'sig-row' : ''}>
                <td>{lag.lag}</td>
                <td>
                  <strong>{fmtPct(lag.reverse_conditional)}</strong>
                </td>
                <td>{fmtPct(lag.base_rate)}</td>
                <td>
                  {fmt(lag.relative_risk)}
                  {lag.ci_low !== null && lag.ci_high !== null && (
                    <span class="ci">
                      {' '}
                      ({fmt(lag.ci_low)}–{fmt(lag.ci_high)})
                    </span>
                  )}
                </td>
                <td>
                  {fmt(lag.p_value, 3)}
                  <span class="test-tag"> {lag.test === 'fisher' ? 'F' : 'χ²'}</span>
                </td>
                <td>
                  {lag.onsets_exposed}/{lag.onsets}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Results: continuous scatter ---
function ContinuousResults({ data }: { data: ContinuousCorrelationData }) {
  const points = data.series
  const xs = points.map((p) => p.trigger)
  const ys = points.map((p) => p.outcome)
  const xMin = Math.min(...xs, 0)
  const xMax = Math.max(...xs, 1)
  const yMin = Math.min(...ys, 0)
  const yMax = Math.max(...ys, 1)
  const w = 320
  const h = 220
  const pad = 30
  const sx = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (w - 2 * pad)
  const sy = (y: number) => h - pad - ((y - yMin) / (yMax - yMin || 1)) * (h - 2 * pad)

  return (
    <div class="explore-results">
      <p class="explore-summary">
        n={data.n} · Pearson r={fmt(data.pearson)} · Spearman ρ={fmt(data.spearman)} · lag {data.lag_days}d
      </p>
      <svg width={w} height={h} class="scatter">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#ccc" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#ccc" />
        {points.map((p) => (
          <circle cx={sx(p.trigger)} cy={sy(p.outcome)} r={3} fill="#673ab8" opacity={0.5} />
        ))}
      </svg>
    </div>
  )
}

type ExploreResult =
  | { kind: 'event'; data: GenericCorrelationData }
  | { kind: 'continuous'; data: ContinuousCorrelationData }

/** Run the active-mode correlation request. Extracted to keep ExploreTab simple. */
const runExplore = async (): Promise<ExploreResult> => {
  const period = {
    period_days: periodStart.value ? undefined : periodDays.value,
    period_end: periodEnd.value || undefined,
    period_start: periodStart.value || undefined,
  }
  if (mode.value === 'event') {
    const built = buildRequest()!
    const data = await fetchGenericCorrelation({
      ...period,
      denominator: denominator.value,
      lag_windows: parseLagWindows(lagWindowsInput.value),
      outcome: { ...built.outcome, collapse_gap_days: collapseGapDays.value },
      triggers: [built.triggerCondition],
    })
    return { kind: 'event', data }
  }
  const data = await fetchContinuousCorrelation({
    ...period,
    lag_days: lagDaysInput.value,
    outcome: outcomeSelector.value,
    trigger: triggerSelector.value,
  })
  return { kind: 'continuous', data }
}

// eslint-disable-next-line complexity -- form render branches on mode/selector kind
export function ExploreTab() {
  const selectorsQuery = useQuery({
    queryFn: fetchCorrelationSelectors,
    queryKey: ['correlationSelectors'],
    staleTime: 5 * 60 * 1000,
  })

  const resultQuery = useQuery({
    enabled: runToken.value > 0,
    queryFn: runExplore,
    queryKey: ['exploreCorrelation', runToken.value],
    staleTime: 5 * 60 * 1000,
  })

  const result = resultQuery.data
  const selectors = selectorsQuery.data

  return (
    <div class="explore-tab">
      <p class="intro-text">
        Explore how any trigger relates to any outcome. <strong>Event onset</strong> mode is for presence-only
        outcomes (e.g. back_pain) — it collapses multi-day flares into onsets and corrects for how often a
        trigger occurs, reporting P(recent trigger | onset) beside the base rate. <strong>Continuous</strong>{' '}
        mode correlates two daily series (e.g. carb intake vs sleep score).
      </p>

      <div class="explore-form">
        <div class="explore-row">
          <label>Mode</label>
          <div class="explore-toggle">
            <button class={mode.value === 'event' ? 'active' : ''} onClick={() => setMode('event')}>
              Event onset
            </button>
            <button
              class={mode.value === 'continuous' ? 'active' : ''}
              onClick={() => setMode('continuous')}
            >
              Continuous
            </button>
          </div>
        </div>

        <div class="explore-row">
          <label>Trigger</label>
          <SelectorPicker
            value={triggerSelector.value}
            onChange={(s) => (triggerSelector.value = s)}
            selectors={selectors}
            allowedKinds={
              mode.value === 'event'
                ? ['tag', 'activity', 'nutrition', 'productivity_category', 'productivity_app']
                : ['metric', 'nutrition', 'tag', 'activity', 'productivity_category', 'productivity_app']
            }
          />
        </div>

        <div class="explore-row">
          <label>Outcome</label>
          {mode.value === 'event' ? (
            <div class="selector-picker">
              <select
                value={eventOutcomeSource.value}
                onChange={(e) =>
                  (eventOutcomeSource.value = (e.target as HTMLSelectElement).value as 'metric' | 'tag')
                }
              >
                <option value="metric">metric</option>
                <option value="tag">tag</option>
              </select>
              <input
                list="metric-options"
                placeholder={eventOutcomeSource.value === 'metric' ? 'metric (e.g. back_pain)' : 'tag regex'}
                value={eventOutcomeValue.value}
                onInput={(e) => (eventOutcomeValue.value = (e.target as HTMLInputElement).value)}
              />
              <datalist id="metric-options">
                {selectors?.metrics.map((m) => (
                  <option value={m.value}>{m.label}</option>
                ))}
              </datalist>
            </div>
          ) : (
            <SelectorPicker
              value={outcomeSelector.value}
              onChange={(s) => (outcomeSelector.value = s)}
              selectors={selectors}
              allowedKinds={['metric', 'nutrition', 'tag', 'activity', 'productivity_category']}
            />
          )}
        </div>

        {mode.value === 'event' ? (
          <>
            <div class="explore-row">
              <label>Lag windows</label>
              <input
                value={lagWindowsInput.value}
                onInput={(e) => (lagWindowsInput.value = (e.target as HTMLInputElement).value)}
                placeholder="24h,48h,7d"
              />
            </div>
            <div class="explore-row">
              <label>Collapse gap (days)</label>
              <input
                type="number"
                value={collapseGapDays.value}
                onInput={(e) =>
                  (collapseGapDays.value = parseInt((e.target as HTMLInputElement).value, 10) || 0)
                }
              />
            </div>
            <div class="explore-row">
              <label>Denominator</label>
              <div class="explore-toggle">
                <button
                  class={denominator.value === 'known' ? 'active' : ''}
                  onClick={() => (denominator.value = 'known')}
                >
                  Known days
                </button>
                <button
                  class={denominator.value === 'all' ? 'active' : ''}
                  onClick={() => (denominator.value = 'all')}
                >
                  All days
                </button>
              </div>
            </div>
          </>
        ) : (
          <div class="explore-row">
            <label>Outcome lag (days)</label>
            <input
              type="number"
              value={lagDaysInput.value}
              onInput={(e) => (lagDaysInput.value = parseInt((e.target as HTMLInputElement).value, 10) || 0)}
            />
          </div>
        )}

        <div class="explore-row">
          <label>Regime</label>
          <div class="explore-regime">
            <input
              type="date"
              value={periodStart.value}
              onInput={(e) => (periodStart.value = (e.target as HTMLInputElement).value)}
            />
            <span>to</span>
            <input
              type="date"
              value={periodEnd.value}
              onInput={(e) => (periodEnd.value = (e.target as HTMLInputElement).value)}
            />
            {!periodStart.value && (
              <span class="regime-hint">
                or last
                <input
                  type="number"
                  class="period-days-input"
                  value={periodDays.value}
                  onInput={(e) =>
                    (periodDays.value = parseInt((e.target as HTMLInputElement).value, 10) || 90)
                  }
                />
                days
              </span>
            )}
          </div>
        </div>

        <div class="explore-row">
          <button class="explore-run" onClick={() => (runToken.value += 1)}>
            Run analysis
          </button>
        </div>
      </div>

      {resultQuery.isFetching && <div class="loading">Analyzing…</div>}
      {resultQuery.isError && <div class="explore-error">Analysis failed. Check the inputs and retry.</div>}
      {result?.kind === 'event' && <EventOutcomeResults data={result.data} />}
      {result?.kind === 'continuous' && <ContinuousResults data={result.data} />}
    </div>
  )
}
