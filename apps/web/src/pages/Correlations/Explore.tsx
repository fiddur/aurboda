import type {
  ContinuousCorrelationData,
  CorrelationSelector,
  CorrelationSelectorsData,
  EventOutcome,
  GenericCorrelationData,
  GroupComparison,
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
import { describeSelectorAxis, fiveNumberSummary, linearRegression } from './exploreCharts'
import {
  describeCorrelationStrength,
  describeEffectSize,
  eventOutcomeLooksContinuous,
  MODE_HELP,
  sampleCaution,
  TOOLTIPS,
} from './exploreGuidance'

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
// Continuous mode: drop nutrition days lacking real macros (flag-only) when set.
const nutritionCompleteness = signal<'all' | 'complete_only'>('all')
// Defaults to 'all' since the default outcome source is a (presence-only) metric.
const denominator = signal<'known' | 'all'>('all')
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

// Every selector kind (continuous mode allows a metric on either side).
const ALL_SELECTOR_KINDS: CorrelationSelector['kind'][] = ['metric', ...EVENT_TRIGGER_KINDS]

/** Switch mode, clamping the trigger to a kind valid in the new mode. */
const setMode = (next: Mode) => {
  mode.value = next
  if (next === 'event' && !EVENT_TRIGGER_KINDS.includes(triggerSelector.value.kind)) {
    triggerSelector.value = { kind: 'tag', pattern: '' }
  }
}

/**
 * Switch the event-outcome source, picking a sensible denominator default:
 * presence-only metrics (rows only on "bad" days) need the whole-regime
 * denominator, otherwise the known-day set collapses to the onsets themselves
 * and the base-rate comparison is meaningless. Tags are fully known, so 'known'.
 */
const setEventOutcomeSource = (next: 'metric' | 'tag') => {
  eventOutcomeSource.value = next
  denominator.value = next === 'metric' ? 'all' : 'known'
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

const fmtP = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : value < 0.001 ? '<0.001' : value.toFixed(3)

/** Whether the current event-mode form would misuse a continuous outcome. */
const outcomeLooksContinuous = (): boolean =>
  eventOutcomeLooksContinuous(mode.value, eventOutcomeSource.value, eventOutcomeValue.value)

/** Apply a back-pain-onset event preset for the given trigger tag. */
const applyEventPreset = (pattern: string) => {
  setMode('event')
  triggerSelector.value = { kind: 'tag', pattern }
  setEventOutcomeSource('metric')
  eventOutcomeValue.value = 'back_pain'
  lagWindowsInput.value = '24h,48h,72h,7d'
  collapseGapDays.value = 3
  // Scope to the behavioural regime the #792 worked example uses (the date the
  // relevant protocol/era began); a leak is rare and meaningful only from here.
  periodStart.value = '2019-09-28'
  periodEnd.value = ''
}

/** Worked examples that teach the modes by populating the whole form. */
const PRESETS: { label: string; apply: () => void }[] = [
  {
    apply: () => {
      setMode('continuous')
      triggerSelector.value = { kind: 'nutrition', nutrient: 'carbs' }
      outcomeSelector.value = { kind: 'metric', metric: 'sleep_score' }
      lagDaysInput.value = 1
      periodStart.value = ''
      periodEnd.value = ''
      periodDays.value = 365
    },
    label: 'Carbs → sleep (Continuous)',
  },
  { apply: () => applyEventPreset('ejaculation'), label: 'Ejaculation → back-pain onset (Event)' },
  { apply: () => applyEventPreset('sauna'), label: 'Sauna → back-pain onset (Event)' },
]

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

// --- Results: per-lag relative-risk bars with 95% CI whiskers ---
function RrBars({ perLag }: { perLag: LagExposureResultData[] }) {
  const items = perLag.filter((l) => l.relative_risk !== null)
  if (items.length === 0) return null
  const w = 340
  const h = 200
  const pad = { bottom: 26, left: 40, right: 12, top: 16 }
  const maxRr = Math.max(2, ...items.map((l) => l.ci_high ?? l.relative_risk!))
  const sy = (v: number) => h - pad.bottom - (v / maxRr) * (h - pad.top - pad.bottom)
  const band = (w - pad.left - pad.right) / items.length

  return (
    <svg width={w} height={h} class="rr-bars">
      <text x={pad.left} y={pad.top - 4} class="axis-label">
        Relative risk (95% CI)
      </text>
      {/* RR=1 reference line — no effect / base rate */}
      <line x1={pad.left} y1={sy(1)} x2={w - pad.right} y2={sy(1)} stroke="#999" stroke-dasharray="4 3" />
      <text x={w - pad.right} y={sy(1) - 3} text-anchor="end" class="axis-label">
        RR=1
      </text>
      {items.map((l, i) => {
        const cx = pad.left + band * (i + 0.5)
        const sig = l.p_value < 0.05
        return (
          <g>
            {l.ci_low !== null && l.ci_high !== null && (
              <line x1={cx} y1={sy(l.ci_low)} x2={cx} y2={sy(l.ci_high)} stroke="#555" />
            )}
            <circle cx={cx} cy={sy(l.relative_risk!)} r={4} fill={sig ? '#2e7d32' : '#673ab8'} />
            <text x={cx} y={h - 10} text-anchor="middle" class="axis-label">
              {l.lag}
            </text>
          </g>
        )
      })}
    </svg>
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
      <RrBars perLag={eo.per_lag} />
    </div>
  )
}

// --- Results: present-vs-absent group comparison for a binary trigger ---
function GroupComparisonPanel({ gc }: { gc: GroupComparison }) {
  const better =
    gc.difference === null ? '' : gc.difference > 0 ? 'higher when present' : 'lower when present'
  return (
    <div class="group-comparison">
      <p class="explore-verdict">
        With trigger: <strong>{fmt(gc.mean_with, 1)}</strong> (n={gc.n_with}) · Without:{' '}
        <strong>{fmt(gc.mean_without, 1)}</strong> (n={gc.n_without}) · Difference{' '}
        <strong>
          {gc.difference !== null && gc.difference > 0 ? '+' : ''}
          {fmt(gc.difference, 1)}
        </strong>{' '}
        {better}
      </p>
      <p class="explore-verdict-sub">
        Effect size: {describeEffectSize(gc.cohens_d)} (Cohen's d {fmt(gc.cohens_d)})
        {gc.welch && <> · Welch t-test p={fmtP(gc.welch.p_value)}</>}
        {gc.mann_whitney && <> · Mann–Whitney p={fmtP(gc.mann_whitney.p_value)}</>}
      </p>
    </div>
  )
}

const CHART_W = 340
const CHART_H = 240
const CHART_PAD = { bottom: 38, left: 46, right: 12, top: 14 }

/** Rotated y-axis label + horizontal x-axis label for a chart. */
function AxisLabels({ x, y }: { x: string; y: string }) {
  const midX = (CHART_PAD.left + (CHART_W - CHART_PAD.right)) / 2
  const midY = (CHART_PAD.top + (CHART_H - CHART_PAD.bottom)) / 2
  return (
    <>
      <text x={midX} y={CHART_H - 4} text-anchor="middle" class="axis-label">
        {x}
      </text>
      <text x={12} y={midY} text-anchor="middle" class="axis-label" transform={`rotate(-90 12 ${midY})`}>
        {y}
      </text>
    </>
  )
}

// --- Results: continuous scatter with regression line + annotation ---
function ScatterPlot({ data }: { data: ContinuousCorrelationData }) {
  const points = data.series
  const xs = points.map((p) => p.trigger)
  const ys = points.map((p) => p.outcome)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const sx = (x: number) =>
    CHART_PAD.left + ((x - xMin) / (xMax - xMin || 1)) * (CHART_W - CHART_PAD.left - CHART_PAD.right)
  const sy = (y: number) =>
    CHART_H -
    CHART_PAD.bottom -
    ((y - yMin) / (yMax - yMin || 1)) * (CHART_H - CHART_PAD.top - CHART_PAD.bottom)
  const reg = linearRegression(xs, ys)

  return (
    <svg width={CHART_W} height={CHART_H} class="scatter">
      <line
        x1={CHART_PAD.left}
        y1={CHART_H - CHART_PAD.bottom}
        x2={CHART_W - CHART_PAD.right}
        y2={CHART_H - CHART_PAD.bottom}
        stroke="#ccc"
      />
      <line
        x1={CHART_PAD.left}
        y1={CHART_PAD.top}
        x2={CHART_PAD.left}
        y2={CHART_H - CHART_PAD.bottom}
        stroke="#ccc"
      />
      {points.map((p) => (
        <circle cx={sx(p.trigger)} cy={sy(p.outcome)} r={3} fill="#673ab8" opacity={0.45} />
      ))}
      {reg && (
        <line
          x1={sx(xMin)}
          y1={sy(reg.slope * xMin + reg.intercept)}
          x2={sx(xMax)}
          y2={sy(reg.slope * xMax + reg.intercept)}
          stroke="#e0457b"
          stroke-width={2}
        />
      )}
      <text x={CHART_PAD.left + 6} y={CHART_PAD.top + 10} class="plot-annot">
        r={fmt(data.pearson)} · ρ={fmt(data.spearman)} · n={data.n} · p={fmtP(data.pearson_p)}
      </text>
      <AxisLabels x={describeSelectorAxis(data.trigger)} y={describeSelectorAxis(data.outcome)} />
    </svg>
  )
}

// --- Results: present-vs-absent box plot for a binary trigger ---
function BoxPlot({ data }: { data: ContinuousCorrelationData }) {
  const withVals = data.series.filter((p) => p.trigger > 0).map((p) => p.outcome)
  const withoutVals = data.series.filter((p) => p.trigger === 0).map((p) => p.outcome)
  const absent = fiveNumberSummary(withoutVals)
  const present = fiveNumberSummary(withVals)
  if (!absent || !present) return null
  const all = [...withVals, ...withoutVals]
  const yMin = Math.min(...all)
  const yMax = Math.max(...all)
  const sy = (y: number) =>
    CHART_H -
    CHART_PAD.bottom -
    ((y - yMin) / (yMax - yMin || 1)) * (CHART_H - CHART_PAD.top - CHART_PAD.bottom)
  const gc = data.group_comparison
  const boxes = [
    {
      color: '#9aa0a6',
      label: `Absent (n=${gc?.n_without ?? withoutVals.length})`,
      s: absent,
      x: CHART_W * 0.34,
    },
    {
      color: '#673ab8',
      label: `Present (n=${gc?.n_with ?? withVals.length})`,
      s: present,
      x: CHART_W * 0.68,
    },
  ]
  const bw = 46

  return (
    <svg width={CHART_W} height={CHART_H} class="boxplot">
      <line
        x1={CHART_PAD.left}
        y1={CHART_PAD.top}
        x2={CHART_PAD.left}
        y2={CHART_H - CHART_PAD.bottom}
        stroke="#ccc"
      />
      {boxes.map((g) => (
        <g>
          <line x1={g.x} y1={sy(g.s.min)} x2={g.x} y2={sy(g.s.max)} stroke={g.color} />
          <rect
            x={g.x - bw / 2}
            y={sy(g.s.q3)}
            width={bw}
            height={Math.max(1, sy(g.s.q1) - sy(g.s.q3))}
            fill={g.color}
            opacity={0.25}
            stroke={g.color}
          />
          <line
            x1={g.x - bw / 2}
            y1={sy(g.s.median)}
            x2={g.x + bw / 2}
            y2={sy(g.s.median)}
            stroke={g.color}
            stroke-width={2}
          />
          <text x={g.x} y={CHART_H - 22} text-anchor="middle" class="axis-label">
            {g.label}
          </text>
        </g>
      ))}
      <AxisLabels x="trigger present?" y={describeSelectorAxis(data.outcome)} />
    </svg>
  )
}

// --- Results: continuous mode (scatter or box plot, with verdicts) ---
function ContinuousResults({ data }: { data: ContinuousCorrelationData }) {
  const gc = data.group_comparison
  // A Pearson r on a binary/presence trigger is misleading, so when the trigger
  // is binary the group comparison is the headline rather than the correlation.
  const showGroupAsHeadline = gc !== null && gc.trigger_is_binary
  const caution = sampleCaution(data.n)

  return (
    <div class="explore-results">
      <p class="explore-summary">
        n={data.n}
        {data.n_complete !== null && ` (${data.n_complete} with full nutrition)`} · Pearson r=
        {fmt(data.pearson)} · Spearman ρ={fmt(data.spearman)} · lag {data.lag_days}d
      </p>
      {!showGroupAsHeadline && (
        <p class="explore-verdict">{describeCorrelationStrength(data.pearson)} correlation</p>
      )}
      {gc && (
        <>
          {showGroupAsHeadline && (
            <p class="explore-help">
              The trigger is binary, so a correlation coefficient is misleading — compare the groups instead:
            </p>
          )}
          <GroupComparisonPanel gc={gc} />
        </>
      )}
      {/* Shown in both modes: a small-n caution matters most for a present-vs-absent split. */}
      {caution && <p class="explore-verdict explore-caution">⚠ {caution}</p>}
      {showGroupAsHeadline ? <BoxPlot data={data} /> : <ScatterPlot data={data} />}
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
    nutrition_completeness: nutritionCompleteness.value,
    outcome: outcomeSelector.value,
    trigger: triggerSelector.value,
  })
  return { kind: 'continuous', data }
}

/** Continuous mode: is either side a nutrition dimension (so completeness applies)? */
const continuousHasNutrition = (): boolean =>
  triggerSelector.value.kind === 'nutrition' || outcomeSelector.value.kind === 'nutrition'

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
          <label>Presets</label>
          <div class="explore-presets">
            {PRESETS.map((preset) => (
              <button class="explore-preset" onClick={preset.apply}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div class="explore-row">
          <label>Mode</label>
          <div class="explore-toggle">
            <button class={mode.value === 'event' ? 'active' : ''} onClick={() => setMode('event')}>
              Event onset
            </button>
            <button class={mode.value === 'continuous' ? 'active' : ''} onClick={() => setMode('continuous')}>
              Continuous
            </button>
          </div>
        </div>
        <p class="explore-help">{MODE_HELP}</p>

        <div class="explore-row">
          <label>Trigger</label>
          <SelectorPicker
            value={triggerSelector.value}
            onChange={(s) => (triggerSelector.value = s)}
            selectors={selectors}
            allowedKinds={mode.value === 'event' ? EVENT_TRIGGER_KINDS : ALL_SELECTOR_KINDS}
          />
        </div>

        <div class="explore-row">
          <label>Outcome</label>
          {mode.value === 'event' ? (
            <div class="selector-picker">
              <select
                value={eventOutcomeSource.value}
                onChange={(e) =>
                  setEventOutcomeSource((e.target as HTMLSelectElement).value as 'metric' | 'tag')
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
              allowedKinds={ALL_SELECTOR_KINDS}
            />
          )}
        </div>

        {outcomeLooksContinuous() && (
          <p class="explore-warning">
            ⚠ This outcome looks continuous (it has a value most days). Event-onset may not be meaningful here
            — consider <strong>Continuous</strong> mode.
          </p>
        )}

        {mode.value === 'event' ? (
          <>
            <div class="explore-row">
              <label title={TOOLTIPS.lagWindows}>Lag windows</label>
              <input
                value={lagWindowsInput.value}
                onInput={(e) => (lagWindowsInput.value = (e.target as HTMLInputElement).value)}
                placeholder="24h,48h,7d"
                title={TOOLTIPS.lagWindows}
              />
            </div>
            <div class="explore-row">
              <label title={TOOLTIPS.collapseGap}>Collapse gap (days)</label>
              <input
                type="number"
                value={collapseGapDays.value}
                onInput={(e) =>
                  (collapseGapDays.value = parseInt((e.target as HTMLInputElement).value, 10) || 0)
                }
              />
            </div>
            <div class="explore-row">
              <label title={TOOLTIPS.denominator}>Denominator</label>
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
              <span class="regime-hint">
                Use <strong>All days</strong> for presence-only metrics (e.g. back_pain) that only log on bad
                days; <strong>Known days</strong> for metrics that log explicit zeros.
              </span>
            </div>
          </>
        ) : (
          <>
            <div class="explore-row">
              <label>Outcome lag (days)</label>
              <input
                type="number"
                value={lagDaysInput.value}
                onInput={(e) =>
                  (lagDaysInput.value = parseInt((e.target as HTMLInputElement).value, 10) || 0)
                }
              />
            </div>
            {continuousHasNutrition() && (
              <div class="explore-row">
                <label title="Flag-only days (a meal logged with no macros) read as noisy zeros.">
                  Nutrition days
                </label>
                <div class="explore-toggle">
                  <button
                    class={nutritionCompleteness.value === 'all' ? 'active' : ''}
                    onClick={() => (nutritionCompleteness.value = 'all')}
                  >
                    All
                  </button>
                  <button
                    class={nutritionCompleteness.value === 'complete_only' ? 'active' : ''}
                    onClick={() => (nutritionCompleteness.value = 'complete_only')}
                  >
                    Full macros only
                  </button>
                </div>
                <span class="regime-hint">
                  Exclude days logged without real macros (flag-only). The result shows how many aligned days
                  had full nutrition either way.
                </span>
              </div>
            )}
          </>
        )}

        <div class="explore-row">
          <label title={TOOLTIPS.regime}>Regime</label>
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
