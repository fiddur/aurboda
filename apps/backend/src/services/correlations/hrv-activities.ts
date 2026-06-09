/**
 * HRV-activities correlation analysis.
 */

import type { HrvContextMetric } from '@aurboda/api-spec'

import type { SyncProvider } from '../queries/index.ts'
import type {
  ActivityCorrelation,
  HrvActivitiesResult,
  LocationCorrelation,
  ProductivityCorrelation,
} from './types.ts'

import { getAllActivitiesInRange, getProductivity, getTimeSeries } from '../../db/index.ts'
import { getPlaceVisits } from '../locations.ts'
import { addBaselineDelta, calculateHrvStats, getDataInRange, pearsonCorrelation } from './utils.ts'

/**
 * Get HRV/HR correlations with different activity types.
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getHrvActivitiesCorrelation(
  user: string,
  periodDays: number = 30,
  sync?: SyncProvider,
  contextMetric: HrvContextMetric = 'hrv_rmssd',
): Promise<HrvActivitiesResult> {
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

  // Fetch all data in parallel
  const [hrvData, hrData, stressData, productivity, locations, activities] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getTimeSeries(user, 'heart_rate', start, end),
    getTimeSeries(user, 'stress_level', start, end),
    getProductivity(user, start, end),
    getPlaceVisits(user, start, end),
    getAllActivitiesInRange(user, start, end),
  ])

  // The series the productivity correlation is computed against. HRV is the
  // default, but heart rate / stress are denser when continuous HRV is sparse.
  const contextData =
    contextMetric === 'heart_rate' ? hrData : contextMetric === 'stress_level' ? stressData : hrvData

  // Calculate baseline stats
  const baselineHrvValues = hrvData.map(([, v]) => v)
  const baselineHrValues = hrData.map(([, v]) => v)
  const baselineStressValues = stressData.map(([, v]) => v)
  const totalMinutes = periodDays * 24 * 60
  const baseline = calculateHrvStats(baselineHrvValues, baselineHrValues, totalMinutes, baselineStressValues)

  // === Productivity correlations by category ===
  const productivityByCategory = new Map<
    string,
    {
      hrvValues: number[]
      hrValues: number[]
      stressValues: number[]
      contextValues: number[]
      minutes: number
      scores: number[]
    }
  >()

  for (const record of productivity) {
    const category = record.resolved_category?.join(' > ') || record.category || 'Uncategorized'
    if (!productivityByCategory.has(category)) {
      productivityByCategory.set(category, {
        contextValues: [],
        hrValues: [],
        hrvValues: [],
        minutes: 0,
        scores: [],
        stressValues: [],
      })
    }
    const cat = productivityByCategory.get(category)!
    cat.minutes += record.duration_sec / 60

    // Get HRV/HR/stress during this productivity window (all shown in the table).
    const hrvInWindow = getDataInRange(hrvData, record.start_time, record.end_time)
    const hrInWindow = getDataInRange(hrData, record.start_time, record.end_time)
    const stressInWindow = getDataInRange(stressData, record.start_time, record.end_time)
    const contextInWindow = getDataInRange(contextData, record.start_time, record.end_time)
    cat.hrvValues.push(...hrvInWindow)
    cat.hrValues.push(...hrInWindow)
    cat.stressValues.push(...stressInWindow)
    cat.contextValues.push(...contextInWindow)

    if (record.productivity !== undefined && record.productivity !== null) {
      // One productivity score per context-metric value, for the correlation.
      cat.scores.push(...contextInWindow.map(() => record.productivity!))
    }
  }

  const productivityCorrelations: ProductivityCorrelation[] = []
  for (const [category, data] of productivityByCategory) {
    if (data.minutes < 10) continue // Skip categories with < 10 min data

    const stats = calculateHrvStats(data.hrvValues, data.hrValues, data.minutes, data.stressValues)
    const statsWithDelta = addBaselineDelta(stats, baseline)

    // Correlation between productivity score and the chosen context metric.
    const correlation =
      data.scores.length >= 3 && data.contextValues.length === data.scores.length
        ? pearsonCorrelation(data.scores, data.contextValues)
        : null

    productivityCorrelations.push({
      ...statsWithDelta,
      category,
      correlation_coefficient: correlation !== null ? Math.round(correlation * 100) / 100 : null,
    })
  }

  // Sort by sample minutes descending
  productivityCorrelations.sort((a, b) => b.sample_minutes - a.sample_minutes)

  // === Location correlations ===
  const locationByName = new Map<
    string,
    { hrvValues: number[]; hrValues: number[]; stressValues: number[]; minutes: number; visits: number }
  >()

  for (const visit of locations) {
    const name = visit.name || 'Unknown'
    if (!locationByName.has(name)) {
      locationByName.set(name, { hrValues: [], hrvValues: [], minutes: 0, stressValues: [], visits: 0 })
    }
    const loc = locationByName.get(name)!
    loc.minutes += visit.duration_minutes
    loc.visits++

    const hrvInWindow = getDataInRange(hrvData, visit.start_time, visit.end_time)
    const hrInWindow = getDataInRange(hrData, visit.start_time, visit.end_time)
    const stressInWindow = getDataInRange(stressData, visit.start_time, visit.end_time)
    loc.hrvValues.push(...hrvInWindow)
    loc.hrValues.push(...hrInWindow)
    loc.stressValues.push(...stressInWindow)
  }

  const locationCorrelations: LocationCorrelation[] = []
  for (const [name, data] of locationByName) {
    if (data.minutes < 30) continue // Skip locations with < 30 min

    const stats = calculateHrvStats(data.hrvValues, data.hrValues, data.minutes, data.stressValues)
    const statsWithDelta = addBaselineDelta(stats, baseline)

    locationCorrelations.push({
      ...statsWithDelta,
      location_name: name,
      visit_count: data.visits,
    })
  }

  locationCorrelations.sort((a, b) => b.sample_minutes - a.sample_minutes)

  // === Activity correlations (unified — includes former tags) ===
  const activityByType = new Map<
    string,
    {
      hrvValues: number[]
      hrValues: number[]
      stressValues: number[]
      minutes: number
      count: number
      hasDuration: boolean
    }
  >()

  for (const activity of activities) {
    const type = activity.activity_type
    if (!activityByType.has(type)) {
      activityByType.set(type, {
        count: 0,
        hasDuration: false,
        hrValues: [],
        hrvValues: [],
        minutes: 0,
        stressValues: [],
      })
    }
    const act = activityByType.get(type)!
    act.count++

    if (activity.end_time) {
      // Duration activity — use actual event window
      act.hasDuration = true
      const durationMin = (activity.end_time.getTime() - activity.start_time.getTime()) / 1000 / 60
      act.minutes += durationMin

      const hrvInWindow = getDataInRange(hrvData, activity.start_time, activity.end_time)
      const hrInWindow = getDataInRange(hrData, activity.start_time, activity.end_time)
      const stressInWindow = getDataInRange(stressData, activity.start_time, activity.end_time)
      act.hrvValues.push(...hrvInWindow)
      act.hrValues.push(...hrInWindow)
      act.stressValues.push(...stressInWindow)
    } else {
      // Point activity — use ±30min contextual window
      const windowStart = new Date(activity.start_time.getTime() - 30 * 60 * 1000)
      const windowEnd = new Date(activity.start_time.getTime() + 30 * 60 * 1000)
      act.minutes += 60 // contextual window is ~60 min

      const hrvInWindow = getDataInRange(hrvData, windowStart, windowEnd)
      const hrInWindow = getDataInRange(hrData, windowStart, windowEnd)
      const stressInWindow = getDataInRange(stressData, windowStart, windowEnd)
      act.hrvValues.push(...hrvInWindow)
      act.hrValues.push(...hrInWindow)
      act.stressValues.push(...stressInWindow)
    }
  }

  const activityCorrelations: ActivityCorrelation[] = []
  for (const [type, data] of activityByType) {
    if (data.count < 1) continue

    const stats = calculateHrvStats(data.hrvValues, data.hrValues, data.minutes, data.stressValues)
    const statsWithDelta = addBaselineDelta(stats, baseline)

    activityCorrelations.push({
      ...statsWithDelta,
      activity_type: type,
      ...(data.hasDuration ? { avg_duration_min: Math.round(data.minutes / data.count) } : {}),
      occurrences: data.count,
    })
  }

  activityCorrelations.sort((a, b) => b.occurrences - a.occurrences)

  return {
    baseline,
    context_metric: contextMetric,
    correlations: {
      activities: activityCorrelations,
      locations: locationCorrelations,
      productivity: productivityCorrelations,
    },
    period: {
      days: periodDays,
      end: end.toISOString(),
      start: start.toISOString(),
    },
  }
}
