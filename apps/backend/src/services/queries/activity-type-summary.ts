import type {
  ActivityTypeSleepSummary,
  ActivityTypeSummary,
  ActivityTypeSummaryQuery,
  SleepStageSummary,
} from '@aurboda/api-spec'

import type { MergedActivity } from '../../db/types.ts'

import { expandActivityTypes, getActivities, getActivityTypeDefinition } from '../../db/index.ts'
import { itemPath, matchesFilter, matchesItemFilter } from './activity-sessions.ts'
import { computeSleepStageSummary } from './daily-summary.ts'
import { buildCategoryMap } from './types.ts'

export interface ActivityTypeSummaryDeps {
  buildCategoryMap: typeof buildCategoryMap
  expandActivityTypes: typeof expandActivityTypes
  getActivities: typeof getActivities
  getActivityTypeDefinition: typeof getActivityTypeDefinition
}

const stageKeys = ['awake_min', 'deep_min', 'light_min', 'rem_min'] as const

const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

const durationMinutes = (a: MergedActivity): number =>
  a.end_time ? (a.end_time.getTime() - a.start_time.getTime()) / 60000 : 0

const distanceMetres = (a: MergedActivity): number | undefined => {
  const v = a.data?.distance
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

const sum = (values: number[]): number => values.reduce((total, v) => total + v, 0)

const matching = (activities: MergedActivity[], query: ActivityTypeSummaryQuery): MergedActivity[] => {
  const { filter_field, filter_value } = query
  if (filter_field === undefined || filter_value === undefined) return activities
  const value = filter_value === '(none)' ? null : filter_value
  const path = itemPath(filter_field)
  return activities.filter((a) =>
    path ? matchesItemFilter(a, path, value) : matchesFilter(a, { field: filter_field, value }),
  )
}

const distanceFigures = (activities: MergedActivity[]) => {
  const withDistance = activities.flatMap((a) => {
    const metres = distanceMetres(a)
    return metres === undefined ? [] : [{ metres, minutes: durationMinutes(a) }]
  })
  if (withDistance.length === 0) {
    return { avg_speed_kmh: null, best_pace_sec_per_km: null, distance_km: null }
  }
  const totalKm = sum(withDistance.map((d) => d.metres)) / 1000
  const totalHours = sum(withDistance.map((d) => d.minutes)) / 60
  const paces = withDistance.filter((d) => d.minutes > 0).map((d) => ((d.minutes * 60) / d.metres) * 1000)
  return {
    avg_speed_kmh: totalHours > 0 ? round(totalKm / totalHours, 2) : null,
    best_pace_sec_per_km: paces.length > 0 ? round(Math.min(...paces), 1) : null,
    distance_km: round(totalKm, 2),
  }
}

const averageStages = (nights: MergedActivity[]): SleepStageSummary | null => {
  const summaries = nights.flatMap((a) => computeSleepStageSummary(a.data) ?? [])
  if (summaries.length === 0) return null
  const averaged: SleepStageSummary = {}
  for (const key of stageKeys) {
    const avg = Math.round(sum(summaries.map((s) => s[key] ?? 0)) / summaries.length)
    if (avg > 0) averaged[key] = avg
  }
  return averaged
}

const sleepFigures = (nights: MergedActivity[]): ActivityTypeSleepSummary | null => {
  if (nights.length === 0) return null
  const minutes = nights.map(durationMinutes)
  return {
    avg_minutes: round(sum(minutes) / nights.length, 1),
    avg_stages: averageStages(nights),
    best_night_minutes: round(Math.max(...minutes), 1),
  }
}

/** One activity type (descendants included) rolled up over `[start, end]`. */
export const getActivityTypeSummary = async (
  user: string,
  activityType: string,
  query: ActivityTypeSummaryQuery,
  deps: ActivityTypeSummaryDeps = {
    buildCategoryMap,
    expandActivityTypes,
    getActivities,
    getActivityTypeDefinition,
  },
): Promise<ActivityTypeSummary> => {
  const [types, definition, categoryMap] = await Promise.all([
    deps.expandActivityTypes(user, [activityType]),
    deps.getActivityTypeDefinition(user, activityType),
    deps.buildCategoryMap(user),
  ])
  const activities = matching(
    await deps.getActivities(
      user,
      types,
      new Date(query.start),
      new Date(query.end),
      undefined,
      undefined,
      categoryMap,
    ),
    query,
  )
  return {
    activity_type_name: definition?.display_name ?? activityType,
    count: activities.length,
    ...distanceFigures(activities),
    sleep: types.includes('sleep') ? sleepFigures(activities) : null,
    total_minutes: round(sum(activities.map(durationMinutes)), 1),
  }
}
