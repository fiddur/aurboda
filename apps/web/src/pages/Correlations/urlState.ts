import type { ActivityImpactType, CorrelationSelector, ImpactFilter } from '@aurboda/api-spec'

import {
  activityImpactTypeSchema,
  cumulativeMetrics,
  DEFAULT_IMPACT_DURATION_BUCKETS,
  DEFAULT_IMPACT_TIME_BUCKETS,
  DEFAULT_IMPACT_WINDOW_MINUTES,
  formatImpactFilters,
  IMPACT_WINDOW_OPTIONS,
  impactDurationBucketsError,
  impactTimeBucketsError,
  isImpactDimension,
  MAX_IMPACT_EXTRA_METRICS,
  parseImpactBucketLimits,
  parseImpactFilters,
  selectorSchema,
} from '@aurboda/api-spec'

import { IMPACT_METRICS, type ImpactMetric } from '../../components/charts/impactMetrics'

export type AnalyzeTab = 'context' | 'explore'
export type ExploreMode = 'event' | 'continuous'
export type EventOutcomeSource = 'metric' | 'tag'
export type Denominator = 'known' | 'all'
export type NutritionCompleteness = 'all' | 'complete_only'

export interface SelectedItem {
  name: string
  type: ActivityImpactType
}

export interface ExploreState {
  mode: ExploreMode
  trigger: CorrelationSelector
  outcome: CorrelationSelector
  outcomeSource: EventOutcomeSource
  outcomeValue: string
  lags: string
  lagDays: number
  gap: number
  nutrition: NutritionCompleteness
  denominator: Denominator
  start: string
  end: string
  days: number
}

export interface AnalyzeState {
  tab: AnalyzeTab
  days: number
  window: number
  metrics: ImpactMetric[]
  extras: string[]
  item: SelectedItem | null
  explore: ExploreState
  /** '' for none, else an impact dimension such as `duration` or `field:session_name`. */
  breakdown: string
  lengths: number[]
  hours: number[]
  filters: ImpactFilter[]
  /** '' picks the chart's metric automatically. */
  breakdownMetric: string
}

export const PERIOD_DAY_OPTIONS = [14, 30, 60, 90] as const

/** Presence-only metrics need the whole-regime denominator; tags are fully known. */
export const defaultDenominator = (source: EventOutcomeSource): Denominator =>
  source === 'metric' ? 'all' : 'known'

export const DEFAULT_EXPLORE_STATE: ExploreState = {
  days: 365,
  denominator: defaultDenominator('metric'),
  end: '',
  gap: 3,
  lagDays: 0,
  lags: '24h,48h,7d',
  mode: 'event',
  nutrition: 'all',
  outcome: { kind: 'metric', metric: '' },
  outcomeSource: 'metric',
  outcomeValue: '',
  start: '',
  trigger: { kind: 'activity', pattern: '' },
}

export const DEFAULT_ANALYZE_STATE: AnalyzeState = {
  breakdown: '',
  breakdownMetric: '',
  days: 30,
  explore: DEFAULT_EXPLORE_STATE,
  extras: [],
  filters: [],
  hours: [...DEFAULT_IMPACT_TIME_BUCKETS],
  item: null,
  lengths: [...DEFAULT_IMPACT_DURATION_BUCKETS],
  metrics: [...IMPACT_METRICS],
  tab: 'context',
  window: DEFAULT_IMPACT_WINDOW_MINUTES,
}

const SELECTOR_KINDS: readonly CorrelationSelector['kind'][] = [
  'metric',
  'activity',
  'nutrition',
  'productivity_category',
  'productivity_app',
]

const selectorValue = (selector: CorrelationSelector): string => {
  switch (selector.kind) {
    case 'metric':
      return selector.metric
    case 'nutrition':
      return selector.nutrient
    default:
      return selector.pattern
  }
}

export const encodeSelector = (selector: CorrelationSelector): string =>
  `${selector.kind}:${selectorValue(selector)}`

/** The selector `kind:value` names, or null; the value may itself contain ':'. */
export const decodeSelector = (raw: string): CorrelationSelector | null => {
  const sep = raw.indexOf(':')
  if (sep < 0) return null
  const kind = raw.slice(0, sep) as CorrelationSelector['kind']
  if (!SELECTOR_KINDS.includes(kind)) return null
  const value = raw.slice(sep + 1)
  const candidate =
    kind === 'metric'
      ? { kind, metric: value }
      : kind === 'nutrition'
        ? { kind, nutrient: value }
        : { kind, pattern: value }
  const parsed = selectorSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/** Whether a URL-given Explore form is complete enough to run on load. */
export const isExploreRunnable = (state: ExploreState): boolean =>
  selectorValue(state.trigger) !== '' &&
  (state.mode === 'event' ? state.outcomeValue !== '' : selectorValue(state.outcome) !== '')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const parseInteger = (raw: string | null, fallback: number, min: number): number => {
  if (raw === null || !/^-?\d+$/.test(raw)) return fallback
  const value = parseInt(raw, 10)
  return value >= min ? value : fallback
}

const parseOneOf = <T extends string | number>(raw: string | null, options: readonly T[], fallback: T): T => {
  if (raw === null) return fallback
  return options.find((option) => String(option) === raw) ?? fallback
}

const EXTRA_METRIC_NAME = /^[a-z][a-z0-9_]*$/
/** The full names of the three fixed metrics, which the short keys already stand for. */
const FIXED_METRIC_NAMES = ['hrv_rmssd', 'heart_rate', 'stress_level']

const isExtraMetricName = (token: string): boolean =>
  EXTRA_METRIC_NAME.test(token) &&
  token.length <= 50 &&
  !(IMPACT_METRICS as readonly string[]).includes(token) &&
  !FIXED_METRIC_NAMES.includes(token) &&
  !(cumulativeMetrics as string[]).includes(token)

/** The short keys go to the three fixed metrics and other metric names to the extras; none at all means the three. */
const parseMetrics = (raw: string | null): Pick<AnalyzeState, 'extras' | 'metrics'> => {
  const given = (raw ?? '').split(',')
  const metrics = IMPACT_METRICS.filter((m) => given.includes(m))
  const extras = [...new Set(given.filter(isExtraMetricName))].slice(0, MAX_IMPACT_EXTRA_METRICS)
  return metrics.length > 0 || extras.length > 0
    ? { extras, metrics }
    : { extras, metrics: [...IMPACT_METRICS] }
}

const parseItem = (name: string | null, type: string | null): SelectedItem | null => {
  if (!name) return null
  const parsed = activityImpactTypeSchema.safeParse(type)
  return parsed.success ? { name, type: parsed.data } : null
}

const parseLimits = (raw: string | null, error: (limits: number[]) => string | null, fallback: number[]) => {
  const limits = parseImpactBucketLimits(raw ?? undefined)
  return limits !== null && error(limits) === null ? limits : [...fallback]
}

const parseSlicing = (
  params: URLSearchParams,
): Pick<AnalyzeState, 'breakdown' | 'breakdownMetric' | 'filters' | 'hours' | 'lengths'> => {
  const breakdown = params.get('breakdown') ?? ''
  const breakdownMetric = params.get('breakdown_metric') ?? ''
  return {
    breakdown: isImpactDimension(breakdown) ? breakdown : '',
    breakdownMetric:
      EXTRA_METRIC_NAME.test(breakdownMetric) && breakdownMetric.length <= 50 ? breakdownMetric : '',
    filters: parseImpactFilters(params.get('filter') ?? undefined) ?? [],
    hours: parseLimits(params.get('hours'), impactTimeBucketsError, DEFAULT_IMPACT_TIME_BUCKETS),
    lengths: parseLimits(params.get('lengths'), impactDurationBucketsError, DEFAULT_IMPACT_DURATION_BUCKETS),
  }
}

const parseExplore = (params: URLSearchParams): ExploreState => {
  const d = DEFAULT_EXPLORE_STATE
  const outcomeSource = parseOneOf(params.get('outcome_source'), ['metric', 'tag'] as const, d.outcomeSource)
  const date = (raw: string | null) => (raw !== null && DATE_RE.test(raw) ? raw : '')
  return {
    days: parseInteger(params.get('explore_days'), d.days, 1),
    denominator: parseOneOf(
      params.get('denominator'),
      ['known', 'all'] as const,
      defaultDenominator(outcomeSource),
    ),
    end: date(params.get('end')),
    gap: parseInteger(params.get('gap'), d.gap, 0),
    lagDays: parseInteger(params.get('lag_days'), d.lagDays, -Infinity),
    lags: params.get('lags') ?? d.lags,
    mode: parseOneOf(params.get('mode'), ['event', 'continuous'] as const, d.mode),
    nutrition: parseOneOf(params.get('nutrition'), ['all', 'complete_only'] as const, d.nutrition),
    outcome: decodeSelector(params.get('outcome') ?? '') ?? d.outcome,
    outcomeSource,
    outcomeValue: params.get('outcome_value') ?? d.outcomeValue,
    start: date(params.get('start')),
    trigger: decodeSelector(params.get('trigger') ?? '') ?? d.trigger,
  }
}

export const parseAnalyzeState = (search: string): AnalyzeState => {
  const params = new URLSearchParams(search)
  const d = DEFAULT_ANALYZE_STATE
  return {
    days: parseOneOf(params.get('days'), PERIOD_DAY_OPTIONS, d.days),
    explore: parseExplore(params),
    item: parseItem(params.get('item'), params.get('item_type')),
    ...parseMetrics(params.get('metrics')),
    tab: parseOneOf(params.get('tab'), ['context', 'explore'] as const, d.tab),
    window: parseOneOf(params.get('window'), IMPACT_WINDOW_OPTIONS, d.window),
    ...parseSlicing(params),
  }
}

/** The page's own params as [param, value, default]; each is left out of the URL when it holds its default. */
const paramValues = (state: AnalyzeState): [string, string, string][] => {
  const d = DEFAULT_ANALYZE_STATE
  const e = state.explore
  const de = DEFAULT_EXPLORE_STATE
  return [
    ['tab', state.tab, d.tab],
    ['days', String(state.days), String(d.days)],
    ['window', String(state.window), String(d.window)],
    ['metrics', [...state.metrics, ...state.extras].join(','), [...d.metrics, ...d.extras].join(',')],
    ['item', state.item?.name ?? '', ''],
    ['item_type', state.item?.type ?? '', ''],
    ['breakdown', state.breakdown, d.breakdown],
    ['lengths', state.lengths.join(','), d.lengths.join(',')],
    ['hours', state.hours.join(','), d.hours.join(',')],
    ['filter', formatImpactFilters(state.filters), ''],
    ['breakdown_metric', state.breakdownMetric, d.breakdownMetric],
    ['mode', e.mode, de.mode],
    ['trigger', encodeSelector(e.trigger), encodeSelector(de.trigger)],
    ['outcome', encodeSelector(e.outcome), encodeSelector(de.outcome)],
    ['outcome_source', e.outcomeSource, de.outcomeSource],
    ['outcome_value', e.outcomeValue, de.outcomeValue],
    ['lags', e.lags, de.lags],
    ['lag_days', String(e.lagDays), String(de.lagDays)],
    ['gap', String(e.gap), String(de.gap)],
    ['nutrition', e.nutrition, de.nutrition],
    ['denominator', e.denominator, defaultDenominator(e.outcomeSource)],
    ['start', e.start, de.start],
    ['end', e.end, de.end],
    ['explore_days', String(e.days), String(de.days)],
  ]
}

/** `href` (absolute) as a path with the page's params set from `state`; every other param and the hash kept. */
export const withAnalyzeState = (href: string, state: AnalyzeState): string => {
  const url = new URL(href)
  for (const [param, value, fallback] of paramValues(state)) {
    url.searchParams.delete(param)
    if (value !== fallback) url.searchParams.set(param, value)
  }
  // Commas, colons and semicolons are legal in a query; leaving them unescaped keeps a shared link
  // readable. A literal '%' is itself escaped as %25, so a filter key's own escapes are left alone.
  const search = url.search.replaceAll('%2C', ',').replaceAll('%3A', ':').replaceAll('%3B', ';')
  return `${url.pathname}${search}${url.hash}`
}

/**
 * The page's tabs and selections live in the URL so a view can be bookmarked or shared. replaceState
 * rather than a route change: the router would remount the page.
 */
export const readAnalyzeState = (): AnalyzeState => {
  try {
    return parseAnalyzeState(window.location.search)
  } catch {
    return DEFAULT_ANALYZE_STATE
  }
}

export const writeAnalyzeState = (state: AnalyzeState): void => {
  try {
    const next = withAnalyzeState(window.location.href, state)
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next !== current) window.history.replaceState(window.history.state, '', next)
  } catch {
    // Without history access the page still works; the view just is not in the URL.
  }
}
