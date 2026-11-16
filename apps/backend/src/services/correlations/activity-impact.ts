import {
  type ActivityImpactMatch,
  type ActivityImpactType,
  type ActivityTypeDefinition,
  DEFAULT_IMPACT_DURATION_BUCKETS,
  DEFAULT_IMPACT_TIME_BUCKETS,
  type ImpactBreakdown,
  type ImpactComparison,
  type ImpactDimensionOption,
  type ImpactFilter,
  type ImpactGroup,
  IMPACT_FIXED_DIMENSIONS,
  MAX_IMPACT_DIMENSION_GROUPS,
  MAX_IMPACT_GROUPS,
  type WindowEffect,
} from '@aurboda/api-spec'

import type { MealFlags } from '../../db/meals.ts'
import type { MergedActivity } from '../../db/types.ts'
import type { SyncProvider } from '../queries/index.ts'
import type { ActivityImpactResult } from './types.ts'

import {
  expandActivityTypes,
  getActivityTypeDefinitions,
  getBinnedTimeSeries,
  getEffectiveActivitiesInRange,
  getMealFlagsInRange,
  getMealLogCompletedInRange,
  getProductivity,
  listSensitivityFlags,
} from '../../db/index.ts'
import {
  flaggedExclusion,
  loadFlaggedWindows,
  seriesWithoutFlagged,
  withoutFlagged,
} from '../flagged-windows.ts'
import { getPlaceVisits } from '../locations.ts'
import { getUserTimezone } from '../settings.ts'
import { localDate } from '../sleep-debt.ts'
import { triggerCorrelationSyncs } from './background-sync.ts'
import {
  breakdownGroups,
  categoricalFieldDimensions,
  type Classification,
  classify,
  type ClassifyContext,
  dimensionListing,
  type DimensionListing,
  type GroupSelection,
  type Occurrence,
  passesFilters,
  schemaFieldLabels,
  sessionMembers,
} from './impact-dimensions.ts'
import {
  activityInterval,
  adjustEffects,
  BIN_MINUTES,
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
import { ancestorsByType, type TypeAncestors, typeAndAncestors } from './type-family.ts'

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

const activityMatcher = (activity: string, match: ActivityImpactMatch, ancestors: TypeAncestors) => {
  const matchesName = (type: string): boolean =>
    match === 'exact' ? type === activity : containsIgnoringCase(type, activity)
  return (act: MergedActivity): boolean => typeAndAncestors(act.activity_type, ancestors).some(matchesName)
}

const atMealTime = (meal: MealFlags): Occurrence => ({ end: meal.time.getTime(), start: meal.time.getTime() })

export interface MealOccurrences {
  flagged: Occurrence[]
  /** Meals without the flag on days marked meal log completed, the only days where such a meal shows it was left out. */
  comparison: Occurrence[]
}

export const mealOccurrences = (
  meals: MealFlags[],
  flag: string,
  completedDays: readonly string[],
  tz: string,
): MealOccurrences => {
  const completed = new Set(completedDays)
  return {
    comparison: meals
      .filter((meal) => !meal.flag_ids.includes(flag) && completed.has(localDate(meal.time, tz)))
      .map(atMealTime),
    flagged: meals.filter((meal) => meal.flag_ids.includes(flag)).map(atMealTime),
  }
}

interface MealSource extends MealOccurrences {
  flagName: string
}

const loadMealSource = async (
  user: string,
  flag: string,
  range: { start: Date; end: Date },
  tz: string | undefined,
): Promise<MealSource> => {
  const zone = tz ?? (await getUserTimezone(user))
  const dayBefore = new Date(range.start.getTime() - DAY_MS)
  const dayAfter = new Date(range.end.getTime() + DAY_MS)
  const [meals, completed, flags] = await Promise.all([
    getMealFlagsInRange(user, range.start, range.end),
    getMealLogCompletedInRange(user, localDate(dayBefore, zone), localDate(dayAfter, zone)),
    listSensitivityFlags(user),
  ])
  return {
    ...mealOccurrences(meals, flag, completed, zone),
    flagName: flags.find((f) => f.id === flag)?.name ?? flag,
  }
}

const findOccurrences = async (
  user: string,
  activity: string,
  activityType: ActivityImpactType,
  match: ActivityImpactMatch,
  start: Date,
  end: Date,
  ancestors: TypeAncestors,
  activities?: MergedActivity[],
  meals?: MealOccurrences,
): Promise<Occurrence[]> => {
  if (activityType === 'meal_sensitivity') return meals?.flagged ?? []
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
  const matches = activityMatcher(activity, match, ancestors)
  const allActivities = activities ?? (await getEffectiveActivitiesInRange(user, start, end))
  return allActivities.filter(matches).map((act) => ({
    ...activityInterval(act),
    ...(activityType === 'activity_type' ? { data: act.data } : {}),
    type: act.activity_type,
  }))
}

const wantsDimension = (slicing: ImpactSlicing, dimension: string): boolean =>
  slicing.includeDimensions === true ||
  slicing.breakdown === dimension ||
  (slicing.filters ?? []).some((f) => f.dimension === dimension)

/** Point meals have no length worth splitting and no data fields; only activities have a type. */
export const listedDimensions = (
  activityType: ActivityImpactType,
  definition: ActivityTypeDefinition | undefined,
): string[] => {
  const meal = activityType === 'meal_sensitivity'
  const fixed = IMPACT_FIXED_DIMENSIONS.filter(
    (d) => !(meal && d === 'duration') && (d !== 'type' || isActivityKind(activityType)),
  )
  return meal ? fixed : [...fixed, ...categoricalFieldDimensions(definition)]
}

const SPLIT_ONLY_WHEN_SEVERAL = new Set(['type', 'year'])

const worthListing = (listing: DimensionListing): boolean =>
  !SPLIT_ONLY_WHEN_SEVERAL.has(listing.dimension) || listing.groups.length > 1

interface SliceSources {
  /** Activities starting in the analysed period, when the analysis reads activities. */
  activities?: MergedActivity[]
  ancestors: TypeAncestors
  definition?: ActivityTypeDefinition
  listed: string[]
  meals?: MealSource
  sleeps: Interval[]
  typeLabels: Map<string, string>
  tz: string
}

/**
 * Activities over the period and, when sleep is needed, sleeps from a day and a window further back
 * to a window further on. The two are separate reads so that a cross-source merge group straddling
 * the period's start folds the same way whether or not sleep is asked for.
 */
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
  const [activities, around, sleepTypes, tz, definitions, meals] = await Promise.all([
    isActivityKind(activityType)
      ? getEffectiveActivitiesInRange(user, range.start, range.end)
      : Promise.resolve(undefined),
    sleep
      ? getEffectiveActivitiesInRange(
          user,
          new Date(range.start.getTime() - windowMs - DAY_MS),
          new Date(range.end.getTime() + windowMs),
        )
      : Promise.resolve([]),
    sleep ? expandActivityTypes(user, ['sleep', 'nap']) : Promise.resolve([]),
    wantsDimension(slicing, 'time_of_day') || wantsDimension(slicing, 'year')
      ? (slicing.tz ?? getUserTimezone(user))
      : 'UTC',
    isActivityKind(activityType) ? getActivityTypeDefinitions(user) : Promise.resolve([]),
    activityType === 'meal_sensitivity'
      ? loadMealSource(user, activity, range, slicing.tz)
      : Promise.resolve(undefined),
  ])
  const ancestors = ancestorsByType(definitions)
  const analysed = isActivityKind(activityType) ? activityMatcher(activity, match, ancestors) : () => false
  const sleeps = around
    .filter((act) => sleepTypes.includes(act.activity_type) && !analysed(act))
    .map(activityInterval)
  const definition = definitions.find((d) => d.name === activity)
  return {
    activities,
    ancestors,
    definition,
    listed: listedDimensions(activityType, definition),
    meals,
    sleeps,
    typeLabels: new Map(definitions.map((d) => [d.name, d.display_name])),
    tz,
  }
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

type EffectsOf = Pick<ImpactGroup, 'hr_effect' | 'hrv_effect' | 'metric_effects' | 'stress_effect'>

const comparisonGroup = (analysis: Analysis, extraMetrics: string[]): ImpactComparison => ({
  hr_effect: analysis.summary.effects.hr,
  hrv_effect: analysis.summary.effects.hrv,
  ...metricEffects(analysis, extraMetrics),
  occurrences: analysis.occurrences,
  stress_effect: analysis.summary.effects.stress,
  timeline: analysis.summary.buckets,
})

const groupEffects = (slice: EffectsOf): WindowEffect[] => [
  slice.hrv_effect,
  slice.hr_effect,
  slice.stress_effect,
  ...Object.values(slice.metric_effects ?? {}),
]

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
  const listed = slicing.includeDimensions ? sources.listed : []
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
    typeLabels: sources.typeLabels,
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
            classified(d)
              .map((c) => dimensionListing(c, MAX_IMPACT_DIMENSION_GROUPS))
              .filter(worthListing),
          ),
        }
      : {}),
    selected,
  }
}

/** The comparison meals, analysed as their own sessions so that the flagged meals do not clip their windows. */
const analyseComparison = (
  meals: MealSource | undefined,
  flagged: Parameters<typeof withoutFlagged>[2],
  series: MetricSeries,
  window: number,
  extraMetrics: string[],
): { comparison?: ImpactComparison; excluded: number } => {
  if (!meals) return { excluded: 0 }
  const found = withoutFlagged(meals.comparison, (o) => o.start, flagged)
  const analysis = analyse(mergeIntoSessions(found.kept), series, window, extraMetrics)
  return { comparison: comparisonGroup(analysis, extraMetrics), excluded: found.excluded }
}

const sourceName = (sources: SliceSources, activity: string): string => sources.meals?.flagName ?? activity

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
  options: { excludeFlagged?: boolean } = {},
): Promise<ActivityImpactResult> {
  const { end, start } = until ? explicitRange(until, periodDays, since) : rangeEndingToday(periodDays)
  const window = clampWindowMinutes(windowMinutes)
  const extraMetrics = extraMetricKeys(requestedExtras)

  // Freshness syncs run in the background — never block this retrospective
  // analysis on a slow external sync (see background-sync.ts).
  triggerCorrelationSyncs(sync, user)

  const { seriesEnd, seriesStart } = extendByWindow(start, end, window)
  const binned = (metric: string) => getBinnedTimeSeries(user, metric, seriesStart, seriesEnd, BIN_MINUTES)
  const [hrv, hr, stress, extraData, sources, flagged] = await Promise.all([
    binned('hrv_rmssd'),
    binned('heart_rate'),
    binned('stress_level'),
    Promise.all(extraMetrics.map(binned)),
    loadSliceSources(user, activity, activityType, match, { end, start }, window, slicing),
    loadFlaggedWindows(user, seriesStart, seriesEnd, options.excludeFlagged),
  ])

  const found = withoutFlagged(
    await findOccurrences(
      user,
      activity,
      activityType,
      match,
      start,
      end,
      sources.ancestors,
      sources.activities,
      sources.meals,
    ),
    (o) => o.start,
    flagged,
  )
  const occurrences = found.kept
  const sessions = mergeIntoSessions(occurrences)
  const binnedSeries = seriesWithoutFlagged<MetricSeries>(
    {
      ...Object.fromEntries(extraMetrics.map((metric, i) => [metric, extraData[i]])),
      hr,
      hrv,
      stress,
    },
    flagged,
  )
  const series = binnedSeries.kept
  const compared = analyseComparison(sources.meals, flagged, series, window, extraMetrics)
  const excludedPoints = found.excluded + compared.excluded + binnedSeries.excluded
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
  const { comparison } = compared
  const { adjust, comparisons } = adjustEffects([
    ...Object.values(effects),
    ...(breakdown?.groups ?? []).flatMap(groupEffects),
    ...(comparison ? groupEffects(comparison) : []),
  ])
  const adjustEffectsOf = <Slice extends EffectsOf>(slice: Slice): Slice => ({
    ...slice,
    hr_effect: adjust(slice.hr_effect),
    hrv_effect: adjust(slice.hrv_effect),
    ...(slice.metric_effects
      ? {
          metric_effects: Object.fromEntries(
            Object.entries(slice.metric_effects).map(([metric, effect]) => [metric, adjust(effect)]),
          ),
        }
      : {}),
    stress_effect: adjust(slice.stress_effect),
  })

  return {
    activity: sourceName(sources, activity),
    activity_type: activityType,
    avg_duration_min: overall.avg_duration_min,
    ...(breakdown ? { breakdown: { ...breakdown, groups: breakdown.groups.map(adjustEffectsOf) } } : {}),
    ...(comparison ? { comparison: adjustEffectsOf(comparison) } : {}),
    comparisons,
    ...(dimensions ? { dimensions } : {}),
    ...flaggedExclusion(flagged, { excluded_points: excludedPoints }),
    ...adjustEffectsOf({
      hr_effect: effects.hr,
      hrv_effect: effects.hrv,
      ...metricEffects(overall, extraMetrics),
      stress_effect: effects.stress,
    }),
    hr_timeline: timeline.hr,
    hrv_timeline: timeline.hrv,
    occurrences: overall.occurrences,
    stress_timeline: timeline.stress,
    timeline: buckets,
    total_occurrences: sessions.length,
    window_minutes: window,
  }
}
