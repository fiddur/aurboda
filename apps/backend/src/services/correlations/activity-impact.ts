import type { ActivityImpactMatch, ActivityImpactType } from '@aurboda/api-spec'

import type { SyncProvider } from '../queries/index.ts'
import type { ActivityImpactResult } from './types.ts'

import { getEffectiveActivitiesInRange, getProductivity, getTimeSeries } from '../../db/index.ts'
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
  productivityCategoryKey,
  summarizeImpact,
} from './impact.ts'

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

const findOccurrences = async (
  user: string,
  activity: string,
  activityType: ActivityImpactType,
  match: ActivityImpactMatch,
  start: Date,
  end: Date,
): Promise<Interval[]> => {
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
  const allActivities = await getEffectiveActivitiesInRange(user, start, end)
  return allActivities
    .filter((act) =>
      exact ? act.activity_type === activity : containsIgnoringCase(act.activity_type, activity),
    )
    .map(activityInterval)
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
): Promise<ActivityImpactResult> {
  const { end, start } = until ? explicitRange(until, periodDays, since) : rangeEndingToday(periodDays)
  const window = clampWindowMinutes(windowMinutes)

  // Freshness syncs run in the background — never block this retrospective
  // analysis on a slow external sync (see background-sync.ts).
  triggerCorrelationSyncs(sync, user)

  const { seriesEnd, seriesStart } = extendByWindow(start, end, window)
  const [hrvData, hrData, stressData] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', seriesStart, seriesEnd),
    getTimeSeries(user, 'heart_rate', seriesStart, seriesEnd),
    getTimeSeries(user, 'stress_level', seriesStart, seriesEnd),
  ])

  const sessions = mergeIntoSessions(await findOccurrences(user, activity, activityType, match, start, end))
  const { buckets, effects, timeline } = summarizeImpact(
    sessions,
    binMetricSeries(hrvData, hrData, stressData),
    window,
  )
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.end - s.start) / 60_000, 0)

  return {
    activity,
    activity_type: activityType,
    avg_duration_min: sessions.length > 0 ? Math.round(totalMinutes / sessions.length) : 0,
    hr_effect: effects.hr,
    hr_timeline: timeline.hr,
    hrv_effect: effects.hrv,
    hrv_timeline: timeline.hrv,
    occurrences: sessions.length,
    stress_effect: effects.stress,
    stress_timeline: timeline.stress,
    timeline: buckets,
    window_minutes: window,
  }
}
