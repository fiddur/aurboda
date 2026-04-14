/**
 * Activity impact timeline analysis.
 */

import type { SyncProvider } from '../queries/index.ts'
import type { ActivityImpactResult, TimeWindowStats } from './types.ts'

import { getAllActivitiesInRange, getProductivity, getTimeSeries } from '../../db/index.ts'
import { getPlaceVisits } from '../locations.ts'
import { getDataInRange, mean, stddev } from './utils.ts'

/**
 * Get HRV timeline before/during/after a specific activity type.
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getActivityImpact(
  user: string,
  activity: string,
  activityType: 'productivity_category' | 'productivity_app' | 'location' | 'tag' | 'activity_type', // 'tag' kept for backward compat
  windowMinutes: number = 30,
  periodDays: number = 90,
  sync?: SyncProvider,
): Promise<ActivityImpactResult> {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)

  // Auto-sync if provider available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  // Fetch HRV/HR/stress data
  const [hrvData, hrData, stressData] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getTimeSeries(user, 'heart_rate', start, end),
    getTimeSeries(user, 'stress_level', start, end),
  ])

  // Find activity occurrences based on type
  interface ActivityWindow {
    startTime: Date
    endTime: Date
    durationMin: number
  }
  const occurrences: ActivityWindow[] = []

  if (activityType === 'productivity_category' || activityType === 'productivity_app') {
    const productivity = await getProductivity(user, start, end)
    for (const record of productivity) {
      const resolvedCatStr = record.resolved_category?.join(' > ')
      const matches =
        activityType === 'productivity_category'
          ? resolvedCatStr?.toLowerCase() === activity.toLowerCase() ||
            record.category?.toLowerCase() === activity.toLowerCase()
          : record.activity.toLowerCase().includes(activity.toLowerCase())

      if (matches) {
        occurrences.push({
          durationMin: record.duration_sec / 60,
          endTime: record.end_time,
          startTime: record.start_time,
        })
      }
    }
  } else if (activityType === 'location') {
    const locations = await getPlaceVisits(user, start, end)
    for (const visit of locations) {
      if (visit.name.toLowerCase().includes(activity.toLowerCase())) {
        occurrences.push({
          durationMin: visit.duration_minutes,
          endTime: visit.end_time,
          startTime: visit.start_time,
        })
      }
    }
  } else if (activityType === 'activity_type' || activityType === 'tag') {
    const allActivities = await getAllActivitiesInRange(user, start, end)
    for (const act of allActivities) {
      if (act.activity_type.toLowerCase().includes(activity.toLowerCase())) {
        const endTime = act.end_time ?? new Date(act.start_time.getTime() + 5 * 60 * 1000)
        occurrences.push({
          durationMin: (endTime.getTime() - act.start_time.getTime()) / 1000 / 60,
          endTime,
          startTime: act.start_time,
        })
      }
    }
  }

  // Collect HRV/HR/stress for each time window
  const windows = {
    after15min: { hr: [] as number[], hrv: [] as number[], stress: [] as number[] },
    after30min: { hr: [] as number[], hrv: [] as number[], stress: [] as number[] },
    before15min: { hr: [] as number[], hrv: [] as number[], stress: [] as number[] },
    before30min: { hr: [] as number[], hrv: [] as number[], stress: [] as number[] },
    during: { hr: [] as number[], hrv: [] as number[], stress: [] as number[] },
  }

  let totalDurationMin = 0

  for (const occ of occurrences) {
    totalDurationMin += occ.durationMin

    // Before 30 min (from -30 to -15)
    const before30Start = new Date(occ.startTime.getTime() - windowMinutes * 60 * 1000)
    const before30End = new Date(occ.startTime.getTime() - (windowMinutes / 2) * 60 * 1000)
    windows.before30min.hrv.push(...getDataInRange(hrvData, before30Start, before30End))
    windows.before30min.hr.push(...getDataInRange(hrData, before30Start, before30End))
    windows.before30min.stress.push(...getDataInRange(stressData, before30Start, before30End))

    // Before 15 min (from -15 to 0)
    const before15Start = new Date(occ.startTime.getTime() - (windowMinutes / 2) * 60 * 1000)
    windows.before15min.hrv.push(...getDataInRange(hrvData, before15Start, occ.startTime))
    windows.before15min.hr.push(...getDataInRange(hrData, before15Start, occ.startTime))
    windows.before15min.stress.push(...getDataInRange(stressData, before15Start, occ.startTime))

    // During
    windows.during.hrv.push(...getDataInRange(hrvData, occ.startTime, occ.endTime))
    windows.during.hr.push(...getDataInRange(hrData, occ.startTime, occ.endTime))
    windows.during.stress.push(...getDataInRange(stressData, occ.startTime, occ.endTime))

    // After 15 min (from end to +15)
    const after15End = new Date(occ.endTime.getTime() + (windowMinutes / 2) * 60 * 1000)
    windows.after15min.hrv.push(...getDataInRange(hrvData, occ.endTime, after15End))
    windows.after15min.hr.push(...getDataInRange(hrData, occ.endTime, after15End))
    windows.after15min.stress.push(...getDataInRange(stressData, occ.endTime, after15End))

    // After 30 min (from +15 to +30)
    const after30End = new Date(occ.endTime.getTime() + windowMinutes * 60 * 1000)
    windows.after30min.hrv.push(...getDataInRange(hrvData, after15End, after30End))
    windows.after30min.hr.push(...getDataInRange(hrData, after15End, after30End))
    windows.after30min.stress.push(...getDataInRange(stressData, after15End, after30End))
  }

  const calculateWindowStats = (values: number[]): TimeWindowStats => ({
    mean: mean(values) !== null ? Math.round(mean(values)! * 10) / 10 : null,
    sample_count: values.length,
    stddev: stddev(values) !== null ? Math.round(stddev(values)! * 10) / 10 : null,
  })

  return {
    activity,
    activity_type: activityType,
    avg_duration_min: occurrences.length > 0 ? Math.round(totalDurationMin / occurrences.length) : 0,
    hr_timeline: {
      after15min: calculateWindowStats(windows.after15min.hr),
      after30min: calculateWindowStats(windows.after30min.hr),
      before15min: calculateWindowStats(windows.before15min.hr),
      before30min: calculateWindowStats(windows.before30min.hr),
      during: calculateWindowStats(windows.during.hr),
    },
    hrv_timeline: {
      after15min: calculateWindowStats(windows.after15min.hrv),
      after30min: calculateWindowStats(windows.after30min.hrv),
      before15min: calculateWindowStats(windows.before15min.hrv),
      before30min: calculateWindowStats(windows.before30min.hrv),
      during: calculateWindowStats(windows.during.hrv),
    },
    occurrences: occurrences.length,
    stress_timeline: {
      after15min: calculateWindowStats(windows.after15min.stress),
      after30min: calculateWindowStats(windows.after30min.stress),
      before15min: calculateWindowStats(windows.before15min.stress),
      before30min: calculateWindowStats(windows.before30min.stress),
      during: calculateWindowStats(windows.during.stress),
    },
  }
}
