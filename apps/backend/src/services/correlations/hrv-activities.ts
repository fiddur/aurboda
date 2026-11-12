import type { HrvContextMetric } from '@aurboda/api-spec'

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

import { getEffectiveActivitiesInRange, getProductivity, getTimeSeries } from '../../db/index.ts'
import { pushAll } from '../../utils.ts'
import { getPlaceVisits } from '../locations.ts'
import { triggerCorrelationSyncs } from './background-sync.ts'
import {
  activityInterval,
  binMetricSeries,
  clampWindowMinutes,
  extendByWindow,
  type Interval,
  locationKey,
  mergeIntoSessions,
  type MetricKey,
  type MetricSeries,
  productivityCategoryKey,
  summarizeImpact,
  valuesBetween,
} from './impact.ts'
import { addBaselineDelta, calculateHrvStats, getDataInRange, pearsonCorrelation } from './utils.ts'

interface GroupContext {
  series: MetricSeries
  windowMinutes: number
  baseline: HrvStats
}

const groupStats = (sessions: Interval[], ctx: GroupContext, sampleMinutes: number): HrvStatsWithDelta => {
  const { effects, timeline } = summarizeImpact(sessions, ctx.series, ctx.windowMinutes)
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
  return {
    ...addBaselineDelta(stats, ctx.baseline),
    hr_effect: effects.hr,
    hrv_effect: effects.hrv,
    stress_effect: effects.stress,
  }
}

const sessionMinutes = (sessions: Interval[]): number =>
  sessions.reduce((sum, { end, start }) => sum + (end - start) / 60_000, 0)

const productivityCorrelations = (
  productivity: ProductivityRecord[],
  contextData: [Date, number][],
  ctx: GroupContext,
): ProductivityCorrelation[] => {
  const byCategory = new Map<
    string,
    { intervals: Interval[]; contextValues: number[]; minutes: number; scores: number[] }
  >()

  for (const record of productivity) {
    const cat = byCategory.getOrInsertComputed(productivityCategoryKey(record), () => ({
      contextValues: [],
      intervals: [],
      minutes: 0,
      scores: [],
    }))
    cat.minutes += record.duration_sec / 60
    cat.intervals.push({ end: record.end_time.getTime(), start: record.start_time.getTime() })

    const contextInWindow = getDataInRange(contextData, record.start_time, record.end_time)
    pushAll(cat.contextValues, contextInWindow)

    if (record.productivity !== undefined && record.productivity !== null) {
      // One productivity score per context-metric value, for the correlation.
      pushAll(
        cat.scores,
        contextInWindow.map(() => record.productivity!),
      )
    }
  }

  const correlations: ProductivityCorrelation[] = []
  for (const [category, data] of byCategory) {
    if (data.minutes < 10) continue // Skip categories with < 10 min data

    // Correlation between productivity score and the chosen context metric.
    const correlation =
      data.scores.length >= 3 && data.contextValues.length === data.scores.length
        ? pearsonCorrelation(data.scores, data.contextValues)
        : null

    correlations.push({
      ...groupStats(mergeIntoSessions(data.intervals), ctx, data.minutes),
      category,
      correlation_coefficient: correlation !== null ? Math.round(correlation * 100) / 100 : null,
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
const activityCorrelations = (activities: Activity[], ctx: GroupContext): ActivityCorrelation[] => {
  const byType = new Map<string, { intervals: Interval[]; hasDuration: boolean }>()

  for (const activity of activities) {
    const act = byType.getOrInsertComputed(activity.activity_type, () => ({
      hasDuration: false,
      intervals: [],
    }))
    if (activity.end_time) act.hasDuration = true
    act.intervals.push(activityInterval(activity))
  }

  const correlations: ActivityCorrelation[] = []
  for (const [type, data] of byType) {
    const sessions = mergeIntoSessions(data.intervals)
    const minutes = sessionMinutes(sessions)

    correlations.push({
      ...groupStats(sessions, ctx, minutes),
      activity_type: type,
      ...(data.hasDuration ? { avg_duration_min: Math.round(minutes / sessions.length) } : {}),
      occurrences: sessions.length,
    })
  }

  return correlations.toSorted((a, b) => b.occurrences - a.occurrences)
}

export async function getHrvActivitiesCorrelation(
  user: string,
  periodDays: number = 30,
  sync?: SyncProvider,
  contextMetric: HrvContextMetric = 'hrv_rmssd',
  windowMinutes: number = 30,
): Promise<HrvActivitiesResult> {
  const window = clampWindowMinutes(windowMinutes)
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
  const [hrvData, hrData, stressData, productivity, locations, activities] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', seriesStart, seriesEnd),
    getTimeSeries(user, 'heart_rate', seriesStart, seriesEnd),
    getTimeSeries(user, 'stress_level', seriesStart, seriesEnd),
    getProductivity(user, start, end),
    getPlaceVisits(user, start, end),
    getEffectiveActivitiesInRange(user, start, end),
  ])

  // The series the productivity correlation is computed against. HRV is the
  // default, but heart rate / stress are denser when continuous HRV is sparse.
  const contextData =
    contextMetric === 'heart_rate' ? hrData : contextMetric === 'stress_level' ? stressData : hrvData

  const series = binMetricSeries(hrvData, hrData, stressData)
  const totalMinutes = periodDays * 24 * 60
  const inPeriod = (metric: MetricKey) => valuesBetween(series[metric], start.getTime(), end.getTime() + 1)
  const baseline = calculateHrvStats(inPeriod('hrv'), inPeriod('hr'), totalMinutes, inPeriod('stress'))
  const ctx: GroupContext = { baseline, series, windowMinutes: window }

  return {
    baseline,
    context_metric: contextMetric,
    correlations: {
      activities: activityCorrelations(activities, ctx),
      locations: locationCorrelations(locations, ctx),
      productivity: productivityCorrelations(productivity, contextData, ctx),
    },
    period: {
      days: periodDays,
      end: end.toISOString(),
      start: start.toISOString(),
    },
    window_minutes: window,
  }
}
