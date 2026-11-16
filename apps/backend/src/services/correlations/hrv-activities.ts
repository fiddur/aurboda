import type {
  ExtraMetricStats,
  HrvContextMetric,
  MealSensitivityCorrelation,
  WindowEffect,
} from '@aurboda/api-spec'

import type { MealFlags } from '../../db/meals.ts'
import type { SensitivityFlag } from '../../db/sensitivities.ts'
import type { Activity, ProductivityRecord } from '../../db/types.ts'
import type { PlaceVisit } from '../locations.ts'
import type { SyncProvider } from '../queries/index.ts'
import type {
  ActivityCorrelation,
  HrvActivitiesResult,
  HrvStats,
  HrvStatsWithDelta,
  LocationCorrelation,
  ProductivityCorrelation,
} from './types.ts'

import {
  getActivityTypeDefinitions,
  getEffectiveActivitiesInRange,
  getMealFlagsInRange,
  getProductivity,
  getTimeSeries,
  listSensitivityFlags,
} from '../../db/index.ts'
import { pushAll } from '../../utils.ts'
import {
  type FlaggedWindow,
  flaggedExclusion,
  loadFlaggedWindows,
  withoutFlagged,
} from '../flagged-windows.ts'
import { getPlaceVisits } from '../locations.ts'
import { triggerCorrelationSyncs } from './background-sync.ts'
import {
  activityInterval,
  adjustEffects,
  binExtraSeries,
  binMetricSeries,
  clampWindowMinutes,
  extendByWindow,
  extraMetricKeys,
  type Interval,
  locationKey,
  mergeIntoSessions,
  type MetricSeries,
  productivityCategoryKey,
  summarizeImpact,
  valuesBetween,
} from './impact.ts'
import { ancestorsByType, type TypeAncestors, typeAndAncestors } from './type-family.ts'
import { addBaselineDelta, calculateHrvStats, getDataInRange, mean, pearsonCorrelation } from './utils.ts'

interface GroupContext {
  series: MetricSeries
  windowMinutes: number
  baseline: HrvStats
  extraMetrics: string[]
  metricBaselines: Record<string, number | null>
}

const deltaFrom = (value: number | null, baseline: number | null | undefined): number | null =>
  value !== null && baseline !== null && baseline !== undefined
    ? Math.round((value - baseline) * 10) / 10
    : null

const groupStats = (sessions: Interval[], ctx: GroupContext, sampleMinutes: number): HrvStatsWithDelta => {
  const { effects, timeline } = summarizeImpact(sessions, ctx.series, ctx.windowMinutes, ctx.extraMetrics)
  const stats: HrvStats = {
    mean_hr: timeline.hr.during.mean,
    mean_hrv: timeline.hrv.during.mean,
    mean_stress: timeline.stress.during.mean,
    sample_count: timeline.hrv.during.sample_count,
    sample_minutes: Math.round(sampleMinutes),
    stddev_hr: timeline.hr.during.stddev,
    stddev_hrv: timeline.hrv.during.stddev,
    stddev_stress: timeline.stress.during.stddev,
  }
  const extras =
    ctx.extraMetrics.length > 0
      ? {
          metrics: Object.fromEntries(
            ctx.extraMetrics.map((metric): [string, ExtraMetricStats] => {
              const { during } = timeline[metric]
              return [
                metric,
                {
                  delta_from_baseline: deltaFrom(during.mean, ctx.metricBaselines[metric]),
                  effect: effects[metric],
                  mean: during.mean,
                  stddev: during.stddev,
                },
              ]
            }),
          ),
        }
      : {}
  return {
    ...addBaselineDelta(stats, ctx.baseline),
    hr_effect: effects.hr,
    hrv_effect: effects.hrv,
    ...extras,
    stress_effect: effects.stress,
  }
}

const sessionMinutes = (sessions: Interval[]): number =>
  sessions.reduce((sum, { end, start }) => sum + (end - start) / 60_000, 0)

type RawSeries = [Date, number][]

interface ProductivitySeries {
  heart_rate: RawSeries
  hrv_rmssd: RawSeries
  stress_level: RawSeries
}

const roundR = (r: number | null): number | null => (r !== null ? Math.round(r * 100) / 100 : null)

/** Pearson r of the productivity score with a metric, pairing each in-window metric value with its record's score. */
const productivityR = (records: ProductivityRecord[], series: RawSeries): number | null => {
  const scores: number[] = []
  const values: number[] = []
  for (const record of records) {
    const score = record.productivity
    if (score === undefined || score === null) continue
    const inWindow = getDataInRange(series, record.start_time, record.end_time)
    pushAll(values, inWindow)
    pushAll(
      scores,
      inWindow.map(() => score),
    )
  }
  return roundR(pearsonCorrelation(scores, values))
}

const productivityCorrelations = (
  productivity: ProductivityRecord[],
  raw: ProductivitySeries,
  extraRaw: Record<string, RawSeries>,
  contextMetric: HrvContextMetric,
  ctx: GroupContext,
): ProductivityCorrelation[] => {
  const byCategory = new Map<
    string,
    { intervals: Interval[]; minutes: number; records: ProductivityRecord[] }
  >()

  for (const record of productivity) {
    const cat = byCategory.getOrInsertComputed(productivityCategoryKey(record), () => ({
      intervals: [],
      minutes: 0,
      records: [],
    }))
    cat.minutes += record.duration_sec / 60
    cat.intervals.push({ end: record.end_time.getTime(), start: record.start_time.getTime() })
    cat.records.push(record)
  }

  const correlations: ProductivityCorrelation[] = []
  for (const [category, data] of byCategory) {
    if (data.minutes < 10) continue // Skip categories with < 10 min data

    const coefficients = {
      heart_rate: productivityR(data.records, raw.heart_rate),
      hrv_rmssd: productivityR(data.records, raw.hrv_rmssd),
      stress_level: productivityR(data.records, raw.stress_level),
    }

    const stats = groupStats(mergeIntoSessions(data.intervals), ctx, data.minutes)
    const metrics = stats.metrics
      ? Object.fromEntries(
          Object.entries(stats.metrics).map(([metric, extra]) => [
            metric,
            { ...extra, correlation_coefficient: productivityR(data.records, extraRaw[metric] ?? []) },
          ]),
        )
      : undefined

    correlations.push({
      ...stats,
      ...(metrics ? { metrics } : {}),
      category,
      correlation_coefficient: coefficients[contextMetric],
      correlation_coefficients: coefficients,
    })
  }

  return correlations.toSorted((a, b) => b.sample_minutes - a.sample_minutes)
}

const locationCorrelations = (visits: PlaceVisit[], ctx: GroupContext): LocationCorrelation[] => {
  const byName = new Map<string, { intervals: Interval[]; minutes: number; visits: number }>()

  for (const visit of visits) {
    const loc = byName.getOrInsertComputed(locationKey(visit), () => ({
      intervals: [],
      minutes: 0,
      visits: 0,
    }))
    loc.minutes += visit.duration_minutes
    loc.visits++
    loc.intervals.push({ end: visit.end_time.getTime(), start: visit.start_time.getTime() })
  }

  const correlations: LocationCorrelation[] = []
  for (const [name, data] of byName) {
    if (data.minutes < 30) continue // Skip locations with < 30 min

    correlations.push({
      ...groupStats(mergeIntoSessions(data.intervals), ctx, data.minutes),
      location_name: name,
      visit_count: data.visits,
    })
  }

  return correlations.toSorted((a, b) => b.sample_minutes - a.sample_minutes)
}

// Activity correlations are unified: they include what used to be tags.
const activityCorrelations = (
  activities: Activity[],
  ctx: GroupContext,
  ancestors: TypeAncestors,
): ActivityCorrelation[] => {
  const byType = new Map<string, { intervals: Interval[]; hasDuration: boolean; subtypes: Set<string> }>()

  for (const activity of activities) {
    for (const type of typeAndAncestors(activity.activity_type, ancestors)) {
      const act = byType.getOrInsertComputed(type, () => ({
        hasDuration: false,
        intervals: [],
        subtypes: new Set(),
      }))
      if (activity.end_time) act.hasDuration = true
      if (type !== activity.activity_type) act.subtypes.add(activity.activity_type)
      act.intervals.push(activityInterval(activity))
    }
  }

  const correlations: ActivityCorrelation[] = []
  for (const [type, data] of byType) {
    const sessions = mergeIntoSessions(data.intervals)
    const minutes = sessionMinutes(sessions)

    correlations.push({
      ...groupStats(sessions, ctx, minutes),
      activity_type: type,
      ...(data.hasDuration ? { avg_duration_min: Math.round(minutes / sessions.length) } : {}),
      ...(data.subtypes.size > 0 ? { includes_subtypes: [...data.subtypes].toSorted() } : {}),
      occurrences: sessions.length,
    })
  }

  return correlations.toSorted((a, b) => b.occurrences - a.occurrences)
}

export const mealCorrelations = (
  meals: MealFlags[],
  flags: SensitivityFlag[],
  ctx: GroupContext,
): MealSensitivityCorrelation[] =>
  flags
    .flatMap((flag) => {
      const intervals = meals
        .filter((meal) => meal.flag_ids.includes(flag.id))
        .map((meal) => ({ end: meal.time.getTime(), start: meal.time.getTime() }))
      if (intervals.length === 0) return []
      const sessions = mergeIntoSessions(intervals)
      return [
        {
          ...groupStats(sessions, ctx, sessionMinutes(sessions)),
          flag_id: flag.id,
          flag_name: flag.name,
          occurrences: sessions.length,
        },
      ]
    })
    .toSorted((a, b) => b.occurrences - a.occurrences)

const rowEffects = (row: HrvStatsWithDelta): WindowEffect[] => [
  row.hrv_effect,
  row.hr_effect,
  row.stress_effect,
  ...Object.values(row.metrics ?? {}).map((extra) => extra.effect),
]

const withAdjustedEffects = <Row extends HrvStatsWithDelta>(
  row: Row,
  adjust: (effect: WindowEffect) => WindowEffect,
): Row => ({
  ...row,
  hr_effect: adjust(row.hr_effect),
  hrv_effect: adjust(row.hrv_effect),
  ...(row.metrics
    ? {
        metrics: Object.fromEntries(
          Object.entries(row.metrics).map(([metric, extra]) => [
            metric,
            { ...extra, effect: adjust(extra.effect) },
          ]),
        ),
      }
    : {}),
  stress_effect: adjust(row.stress_effect),
})

type Series = Awaited<ReturnType<typeof getTimeSeries>>

/** The inputs without the samples, app spans, visits and activities starting in a flagged window. */
const withoutFlaggedInputs = (
  [hrv, hr, stress, productivity, locations, activities, extras]: [
    Series,
    Series,
    Series,
    ProductivityRecord[],
    PlaceVisit[],
    Activity[],
    Series[],
  ],
  flagged: FlaggedWindow[],
) => {
  const atTime = ([time]: Series[number]) => time.getTime()
  const parts = {
    activities: withoutFlagged(activities, (a) => a.start_time.getTime(), flagged),
    hrData: withoutFlagged(hr, atTime, flagged),
    hrvData: withoutFlagged(hrv, atTime, flagged),
    locations: withoutFlagged(locations, (v) => v.start_time.getTime(), flagged),
    productivity: withoutFlagged(productivity, (p) => p.start_time.getTime(), flagged),
    stressData: withoutFlagged(stress, atTime, flagged),
  }
  const extraParts = extras.map((series) => withoutFlagged(series, atTime, flagged))
  return {
    activities: parts.activities.kept,
    excludedPoints: [...Object.values(parts), ...extraParts].reduce((n, p) => n + p.excluded, 0),
    extraData: extraParts.map((p) => p.kept),
    hrData: parts.hrData.kept,
    hrvData: parts.hrvData.kept,
    locations: parts.locations.kept,
    productivity: parts.productivity.kept,
    stressData: parts.stressData.kept,
  }
}

export async function getHrvActivitiesCorrelation(
  user: string,
  periodDays: number = 30,
  sync?: SyncProvider,
  contextMetric: HrvContextMetric = 'hrv_rmssd',
  windowMinutes: number = 30,
  requestedExtras: string[] = [],
  options: { excludeFlagged?: boolean } = {},
): Promise<HrvActivitiesResult> {
  const window = clampWindowMinutes(windowMinutes)
  const extraMetrics = extraMetricKeys(requestedExtras)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)

  // Freshness syncs run in the background — never block the (retrospective)
  // analysis on a slow external sync, which could take minutes (see
  // background-sync.ts). Data is fresh for the next request.
  triggerCorrelationSyncs(sync, user)

  const { seriesEnd, seriesStart } = extendByWindow(start, end, window)
  const [flagged, allMeals, flags, definitions, ...data] = await Promise.all([
    loadFlaggedWindows(user, seriesStart, seriesEnd, options.excludeFlagged),
    getMealFlagsInRange(user, start, end),
    listSensitivityFlags(user),
    getActivityTypeDefinitions(user),
    getTimeSeries(user, 'hrv_rmssd', seriesStart, seriesEnd),
    getTimeSeries(user, 'heart_rate', seriesStart, seriesEnd),
    getTimeSeries(user, 'stress_level', seriesStart, seriesEnd),
    getProductivity(user, start, end),
    getPlaceVisits(user, start, end),
    getEffectiveActivitiesInRange(user, start, end),
    Promise.all(extraMetrics.map((metric) => getTimeSeries(user, metric, seriesStart, seriesEnd))),
  ])
  const { excludedPoints, hrvData, hrData, stressData, productivity, locations, activities, extraData } =
    withoutFlaggedInputs(data, flagged)
  const meals = withoutFlagged(allMeals, (meal) => meal.time.getTime(), flagged)

  const extraRaw = Object.fromEntries(extraMetrics.map((metric, i) => [metric, extraData[i]]))
  const series: MetricSeries = {
    ...binExtraSeries(extraRaw),
    ...binMetricSeries(hrvData, hrData, stressData),
  }
  const totalMinutes = periodDays * 24 * 60
  const inPeriod = (metric: string) => valuesBetween(series[metric], start.getTime(), end.getTime() + 1)
  const baseline = calculateHrvStats(inPeriod('hrv'), inPeriod('hr'), totalMinutes, inPeriod('stress'))
  const metricBaselines = Object.fromEntries(extraMetrics.map((metric) => [metric, mean(inPeriod(metric))]))
  const ctx: GroupContext = { baseline, extraMetrics, metricBaselines, series, windowMinutes: window }
  const tables = {
    activities: activityCorrelations(activities, ctx, ancestorsByType(definitions)),
    locations: locationCorrelations(locations, ctx),
    meals: mealCorrelations(meals.kept, flags, ctx),
    productivity: productivityCorrelations(
      productivity,
      { heart_rate: hrData, hrv_rmssd: hrvData, stress_level: stressData },
      extraRaw,
      contextMetric,
      ctx,
    ),
  }
  const { adjust, comparisons } = adjustEffects(
    [...tables.activities, ...tables.locations, ...tables.meals, ...tables.productivity].flatMap(rowEffects),
  )
  const adjustRow = <Row extends HrvStatsWithDelta>(row: Row): Row => withAdjustedEffects(row, adjust)

  return {
    baseline,
    comparisons,
    context_metric: contextMetric,
    correlations: {
      activities: tables.activities.map(adjustRow),
      locations: tables.locations.map(adjustRow),
      meals: tables.meals.map(adjustRow),
      productivity: tables.productivity.map(adjustRow),
    },
    ...flaggedExclusion(flagged, { excluded_points: excludedPoints + meals.excluded }),
    ...(extraMetrics.length > 0 ? { metric_baselines: metricBaselines } : {}),
    period: {
      days: periodDays,
      end: end.toISOString(),
      start: start.toISOString(),
    },
    window_minutes: window,
  }
}
