import {
  type ActivityImpactMatch,
  type ActivityImpactType,
  type ActivityTypeDefinition,
  DEFAULT_IMPACT_DURATION_BUCKETS,
  DEFAULT_IMPACT_TIME_BUCKETS,
  type ImpactBreakdown,
  type ImpactDimensionOption,
  type ImpactFilter,
  type ImpactGroup,
  impactFieldPath,
  IMPACT_FIXED_DIMENSIONS,
  MAX_IMPACT_DIMENSION_GROUPS,
  MAX_IMPACT_GROUPS,
} from '@aurboda/api-spec'

import type { MergedActivity } from '../../db/types.ts'
import type { SyncProvider } from '../queries/index.ts'
import type { ActivityImpactResult } from './types.ts'

import {
  expandActivityTypes,
  getActivityTypeDefinitions,
  getEffectiveActivitiesInRange,
  getProductivity,
  getTimeSeries,
} from '../../db/index.ts'
import { getPlaceVisits } from '../locations.ts'
import { getUserTimezone } from '../settings.ts'
import { triggerCorrelationSyncs } from './background-sync.ts'
import {
  breakdownGroups,
  categoricalFieldDimensions,
  type Classification,
  classify,
  type ClassifyContext,
  dimensionListing,
  type GroupSelection,
  type Occurrence,
  passesFilters,
  schemaFieldLabels,
  sessionMembers,
} from './impact-dimensions.ts'
import {
  activityInterval,
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
} from './impact.ts'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export interface ImpactSlicing {
  breakdown?: string
  durationBuckets?: number[]
  timeBuckets?: number[]
  filters?: ImpactFilter[]
  includeDimensions?: boolean
  tz?: string
}

const rangeEndingToday = (periodDays: number): { end: Date; start: Date } => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)
  return { end, start }
}

/** From `since` (or `periodDays` days back) to just before `until` (exclusive). */
const explicitRange = (until: Date, periodDays: number, since?: Date): { end: Date; start: Date } => ({
  end: new Date(until.getTime() - 1),
  start: since ?? new Date(until.getTime() - periodDays * 86_400_000),
})

const containsIgnoringCase = (value: string, pattern: string): boolean =>
  value.toLowerCase().includes(pattern.toLowerCase())

const isActivityKind = (activityType: ActivityImpactType): boolean =>
  activityType === 'tag' || activityType === 'activity_type'

const activityMatcher =
  (activity: string, match: ActivityImpactMatch) =>
  (act: MergedActivity): boolean =>
    match === 'exact' ? act.activity_type === activity : containsIgnoringCase(act.activity_type, activity)

const findOccurrences = async (
  user: string,
  activity: string,
  activityType: ActivityImpactType,
  match: ActivityImpactMatch,
  start: Date,
  end: Date,
  activities?: MergedActivity[],
): Promise<Occurrence[]> => {
  const exact = match === 'exact'
  if (activityType === 'productivity_category' || activityType === 'productivity_app') {
    const productivity = await getProductivity(user, start, end)
    return productivity
      .filter((record) => {
        if (activityType === 'productivity_app') {
          return exact ? record.activity === activity : containsIgnoringCase(record.activity, activity)
        }
        if (exact) return productivityCategoryKey(record) === activity
        return (
          record.resolved_category?.join(' > ').toLowerCase() === activity.toLowerCase() ||
          record.category?.toLowerCase() === activity.toLowerCase()
        )
      })
      .map((record) => ({ end: record.end_time.getTime(), start: record.start_time.getTime() }))
  }
  if (activityType === 'location') {
    const locations = await getPlaceVisits(user, start, end)
    return locations
      .filter((visit) =>
        exact ? locationKey(visit) === activity : containsIgnoringCase(visit.name, activity),
      )
      .map((visit) => ({ end: visit.end_time.getTime(), start: visit.start_time.getTime() }))
  }
  const matches = activityMatcher(activity, match)
  const allActivities = activities ?? (await getEffectiveActivitiesInRange(user, start, end))
  return allActivities
    .filter(matches)
    .map((act) =>
      activityType === 'activity_type' ? { ...activityInterval(act), data: act.data } : activityInterval(act),
    )
}

const wantsDimension = (slicing: ImpactSlicing, dimension: string): boolean =>
  slicing.includeDimensions === true ||
  slicing.breakdown === dimension ||
  (slicing.filters ?? []).some((f) => f.dimension === dimension)

const needsDefinitions = (slicing: ImpactSlicing, activityType: ActivityImpactType): boolean =>
  activityType === 'activity_type' &&
  (slicing.includeDimensions === true ||
    (slicing.breakdown !== undefined && impactFieldPath(slicing.breakdown) !== null))

interface SliceSources {
  /** Activities starting in the analysed period, when the analysis reads activities. */
  activities?: MergedActivity[]
  definition?: ActivityTypeDefinition
  sleeps: Interval[]
  tz: string
}

/** Activities over the period, or, when sleep is needed, a day and a window further back and a window further on. */
const loadSliceSources = async (
  user: string,
  activity: string,
  activityType: ActivityImpactType,
  match: ActivityImpactMatch,
  range: { start: Date; end: Date },
  windowMinutes: number,
  slicing: ImpactSlicing,
): Promise<SliceSources> => {
  const sleep = wantsDimension(slicing, 'sleep')
  const windowMs = windowMinutes * MINUTE_MS
  const fetchActivities = sleep
    ? getEffectiveActivitiesInRange(
        user,
        new Date(range.start.getTime() - windowMs - DAY_MS),
        new Date(range.end.getTime() + windowMs),
      )
    : isActivityKind(activityType)
      ? getEffectiveActivitiesInRange(user, range.start, range.end)
      : Promise.resolve(undefined)
  const [activities, sleepTypes, tz, definitions] = await Promise.all([
    fetchActivities,
    sleep ? expandActivityTypes(user, ['sleep', 'nap']) : Promise.resolve([]),
    wantsDimension(slicing, 'time_of_day') ? (slicing.tz ?? getUserTimezone(user)) : 'UTC',
    needsDefinitions(slicing, activityType) ? getActivityTypeDefinitions(user) : Promise.resolve([]),
  ])
  const analysed = isActivityKind(activityType) ? activityMatcher(activity, match) : () => false
  const sleeps = (activities ?? [])
    .filter((act) => sleepTypes.includes(act.activity_type) && !analysed(act))
    .map(activityInterval)
  const inRange = sleep
    ? activities?.filter((act) => act.start_time >= range.start && act.start_time <= range.end)
    : activities
  return { activities: inRange, definition: definitions.find((d) => d.name === activity), sleeps, tz }
}

interface Analysis {
  avg_duration_min: number
  occurrences: number
  summary: ReturnType<typeof summarizeImpact>
}

const analyse = (
  sessions: Interval[],
  series: MetricSeries,
  windowMinutes: number,
  extraMetrics: string[],
  subset?: readonly number[],
): Analysis => {
  const chosen = subset ? subset.map((i) => sessions[i]) : sessions
  const totalMinutes = chosen.reduce((sum, s) => sum + (s.end - s.start) / MINUTE_MS, 0)
  return {
    avg_duration_min: chosen.length > 0 ? Math.round(totalMinutes / chosen.length) : 0,
    occurrences: chosen.length,
    summary: summarizeImpact(sessions, series, windowMinutes, extraMetrics, subset),
  }
}

const metricEffects = (analysis: Analysis, extraMetrics: string[]) =>
  extraMetrics.length > 0
    ? {
        metric_effects: Object.fromEntries(
          extraMetrics.map((metric) => [metric, analysis.summary.effects[metric]]),
        ),
      }
    : {}

interface Slices {
  selected?: number[]
  breakdown?: ImpactBreakdown
  dimensions?: ImpactDimensionOption[]
}

const sliceSessions = (
  sessions: Interval[],
  occurrences: Occurrence[],
  sources: SliceSources,
  slicing: ImpactSlicing,
  analyseGroup: (group: GroupSelection) => ImpactGroup,
  windowMinutes: number,
): Slices => {
  const filters = slicing.filters ?? []
  const listed = slicing.includeDimensions
    ? [...IMPACT_FIXED_DIMENSIONS, ...categoricalFieldDimensions(sources.definition)]
    : []
  const dimensions = [
    ...new Set([
      ...filters.map((f) => f.dimension),
      ...(slicing.breakdown ? [slicing.breakdown] : []),
      ...listed,
    ]),
  ]
  if (dimensions.length === 0) return {}
  const ctx: ClassifyContext = {
    durationLimits: slicing.durationBuckets ?? DEFAULT_IMPACT_DURATION_BUCKETS,
    fieldLabels: schemaFieldLabels(sources.definition),
    members: sessionMembers(sessions, occurrences),
    sessions,
    sleeps: sources.sleeps,
    timeLimits: slicing.timeBuckets ?? DEFAULT_IMPACT_TIME_BUCKETS,
    tz: sources.tz,
    windowMinutes,
  }
  const classifications = dimensions.map((d) => classify(d, ctx))
  const classified = (dimension: string): Classification[] =>
    classifications.filter((c) => c.dimension === dimension)
  const all = sessions.map((_, i) => i)
  const selected =
    filters.length > 0 ? all.filter((i) => passesFilters(classifications, filters, i)) : undefined
  const [breakdownOf] = slicing.breakdown ? classified(slicing.breakdown) : []
  const split = breakdownOf ? breakdownGroups(breakdownOf, selected ?? all, MAX_IMPACT_GROUPS) : undefined
  return {
    ...(breakdownOf && split
      ? {
          breakdown: {
            dimension: breakdownOf.dimension,
            groups: split.groups.map(analyseGroup),
            label: breakdownOf.label,
            omitted_groups: split.omitted,
          },
        }
      : {}),
    ...(slicing.includeDimensions
      ? {
          dimensions: listed.flatMap((d) =>
            classified(d).map((c) => dimensionListing(c, MAX_IMPACT_DIMENSION_GROUPS)),
          ),
        }
      : {}),
    selected,
  }
}

export async function getActivityImpact(
  user: string,
  activity: string,
  activityType: ActivityImpactType,
  windowMinutes: number = 30,
  periodDays: number = 90,
  sync?: SyncProvider,
  until?: Date,
  since?: Date,
  match: ActivityImpactMatch = 'contains',
  requestedExtras: string[] = [],
  slicing: ImpactSlicing = {},
): Promise<ActivityImpactResult> {
  const { end, start } = until ? explicitRange(until, periodDays, since) : rangeEndingToday(periodDays)
  const window = clampWindowMinutes(windowMinutes)
  const extraMetrics = extraMetricKeys(requestedExtras)

  // Freshness syncs run in the background — never block this retrospective
  // analysis on a slow external sync (see background-sync.ts).
  triggerCorrelationSyncs(sync, user)

  const { seriesEnd, seriesStart } = extendByWindow(start, end, window)
  const [hrvData, hrData, stressData, extraData, sources] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', seriesStart, seriesEnd),
    getTimeSeries(user, 'heart_rate', seriesStart, seriesEnd),
    getTimeSeries(user, 'stress_level', seriesStart, seriesEnd),
    Promise.all(extraMetrics.map((metric) => getTimeSeries(user, metric, seriesStart, seriesEnd))),
    loadSliceSources(user, activity, activityType, match, { end, start }, window, slicing),
  ])

  const occurrences = await findOccurrences(
    user,
    activity,
    activityType,
    match,
    start,
    end,
    sources.activities,
  )
  const sessions = mergeIntoSessions(occurrences)
  const series: MetricSeries = {
    ...binExtraSeries(Object.fromEntries(extraMetrics.map((metric, i) => [metric, extraData[i]]))),
    ...binMetricSeries(hrvData, hrData, stressData),
  }
  const analyseGroup = ({ indices, key, label }: GroupSelection): ImpactGroup => {
    const analysis = analyse(sessions, series, window, extraMetrics, indices)
    return {
      avg_duration_min: analysis.avg_duration_min,
      hr_effect: analysis.summary.effects.hr,
      hrv_effect: analysis.summary.effects.hrv,
      key,
      label,
      ...metricEffects(analysis, extraMetrics),
      occurrences: analysis.occurrences,
      stress_effect: analysis.summary.effects.stress,
      timeline: analysis.summary.buckets,
    }
  }
  const { breakdown, dimensions, selected } = sliceSessions(
    sessions,
    occurrences,
    sources,
    slicing,
    analyseGroup,
    window,
  )
  const overall = analyse(sessions, series, window, extraMetrics, selected)
  const { buckets, effects, timeline } = overall.summary

  return {
    activity,
    activity_type: activityType,
    avg_duration_min: overall.avg_duration_min,
    ...(breakdown ? { breakdown } : {}),
    ...(dimensions ? { dimensions } : {}),
    hr_effect: effects.hr,
    hr_timeline: timeline.hr,
    hrv_effect: effects.hrv,
    hrv_timeline: timeline.hrv,
    ...metricEffects(overall, extraMetrics),
    occurrences: overall.occurrences,
    stress_effect: effects.stress,
    stress_timeline: timeline.stress,
    timeline: buckets,
    total_occurrences: sessions.length,
    window_minutes: window,
  }
}
