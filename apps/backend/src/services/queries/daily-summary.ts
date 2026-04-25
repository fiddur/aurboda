/**
 * Daily summary query function.
 */

import { getExerciseTypeName } from '@aurboda/api-spec'

import type {
  ActivitySummary,
  DailySummaryResult,
  HeartRateStats,
  ProductivitySummary,
  SleepLocation,
  SleepSessionSummary,
  SleepStageSummary,
  StressZoneSecs,
  SyncProvider,
} from './types.ts'

import {
  getDailyAggregateValue,
  getMeals,
  getNonSleepActivitiesMerged,
  getNotesForTimeRange,
  getProductivity,
  type ProductivityRecord,
  getScreentimeActivities,
  getSleepSessions,
  getTimeSeries,
  getTimeSeriesMultiMetric,
} from '../../db/index.ts'
import { getScreentimeCategories } from '../../db/screentime-categories.ts'
import { getPlaceVisits, type PlaceVisit } from '../locations.ts'
import { computeHrZoneSecs, getEffectiveHrZones } from '../settings.ts'
import { computeSleepMinutes } from '../sleep-duration.ts'
import { buildCategoryMap, getCommentsMap } from './types.ts'

// ============================================================================
// Sleep stage computation
// ============================================================================

/**
 * Health Connect sleep stage codes -> named stages.
 * 1=Awake, 2=Sleeping/unknown, 3=Out of bed, 4=Light, 5=Deep, 6=REM
 */
interface SleepStageEntry {
  startTime?: string
  endTime?: string
  stage?: number
}

export const computeSleepStageSummary = (
  data: Record<string, unknown> | undefined,
): SleepStageSummary | undefined => {
  if (!data) return undefined
  const stages = data.stages
  if (!Array.isArray(stages) || stages.length === 0) return undefined

  let awakeMs = 0
  let lightMs = 0
  let deepMs = 0
  let remMs = 0

  for (const s of stages as SleepStageEntry[]) {
    if (typeof s.startTime !== 'string' || typeof s.endTime !== 'string') continue
    const ms = new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
    if (ms <= 0) continue

    switch (s.stage) {
      case 1:
        awakeMs += ms
        break
      case 4:
        lightMs += ms
        break
      case 5:
        deepMs += ms
        break
      case 6:
        remMs += ms
        break
      // 2=sleeping/unknown, 3=out of bed — omitted from summary
    }
  }

  const toMin = (ms: number) => (ms > 0 ? Math.round(ms / 60000) : undefined)
  return {
    awake_min: toMin(awakeMs),
    deep_min: toMin(deepMs),
    light_min: toMin(lightMs),
    rem_min: toMin(remMs),
  }
}

// ============================================================================
// Stress zone computation
// ============================================================================

const STRESS_MAX_GAP_SECONDS = 300 // 5 minutes — stress samples are typically 3 minutes apart
const STRESS_SINGLE_SAMPLE_SECONDS = 180 // Garmin reports every ~3 minutes

/**
 * Compute time spent in each stress zone for a time window.
 * Uses the same gap-based accumulation pattern as computeHrZoneSecs.
 */
export const computeStressZoneSecs = (
  stressData: [Date, number][],
  start?: Date,
  end?: Date,
): StressZoneSecs => {
  const result: StressZoneSecs = { high: 0, low: 0, medium: 0, rest: 0 }

  // Filter to time window if specified
  const filtered = start && end ? stressData.filter(([time]) => time >= start && time <= end) : stressData

  if (filtered.length === 0) return result

  const getStressZone = (level: number): keyof StressZoneSecs => {
    if (level <= 25) return 'rest'
    if (level <= 50) return 'low'
    if (level <= 75) return 'medium'
    return 'high'
  }

  if (filtered.length === 1) {
    result[getStressZone(filtered[0][1])] = STRESS_SINGLE_SAMPLE_SECONDS
    return result
  }

  const gaps: number[] = []
  for (let i = 0; i < filtered.length - 1; i++) {
    const [time, level] = filtered[i]
    const nextTime = filtered[i + 1][0]
    const gapSec = Math.min((nextTime.getTime() - time.getTime()) / 1000, STRESS_MAX_GAP_SECONDS)
    gaps.push(gapSec)
    result[getStressZone(level)] += gapSec
  }

  // Last sample: use mean gap
  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const lastZone = getStressZone(filtered[filtered.length - 1][1])
  result[lastZone] += Math.min(meanGap, STRESS_MAX_GAP_SECONDS)

  // Round to whole seconds
  result.rest = Math.round(result.rest)
  result.low = Math.round(result.low)
  result.medium = Math.round(result.medium)
  result.high = Math.round(result.high)

  return result
}

/**
 * Find the best-guess sleep location from place visits overlapping a sleep window.
 * Returns the place with the longest overlap during the sleep window.
 */
export function findSleepLocation(
  sleepStart: Date,
  sleepEnd: Date,
  placeVisits: PlaceVisit[],
): SleepLocation | undefined {
  let bestMatch: PlaceVisit | undefined
  let bestOverlap = 0

  for (const visit of placeVisits) {
    // Calculate overlap between sleep window and visit
    const overlapStart = Math.max(sleepStart.getTime(), visit.start_time.getTime())
    const overlapEnd = Math.min(sleepEnd.getTime(), visit.end_time.getTime())
    const overlap = overlapEnd - overlapStart

    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestMatch = visit
    }
  }

  if (!bestMatch) return undefined

  return {
    lat: bestMatch.lat,
    lon: bestMatch.lon,
    name: bestMatch.name,
    source: bestMatch.source,
  }
}

/**
 * Get a comprehensive summary of health data for a specific day.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getDailySummary(
  user: string,
  date: Date,
  sync?: SyncProvider,
  tz?: string,
): Promise<DailySummaryResult> {
  // Fire-and-forget: trigger background sync so data is fresh for the next request,
  // but return current data immediately to avoid blocking on slow external APIs
  if (sync) {
    void Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
      sync.syncLastFmIfNeeded(user),
      sync.syncGarminIfNeeded(user, 'dailySummary'),
      sync.syncGarminIfNeeded(user, 'heartRate'),
      sync.syncGarminIfNeeded(user, 'hrv'),
      sync.syncGarminIfNeeded(user, 'sleep'),
      sync.syncGarminIfNeeded(user, 'stress'),
      sync.syncGarminIfNeeded(user, 'bodyBattery'),
      sync.syncGarminIfNeeded(user, 'spo2'),
      sync.syncGarminIfNeeded(user, 'respiration'),
      sync.syncGarminIfNeeded(user, 'trainingReadiness'),
      sync.syncGarminIfNeeded(user, 'intensityMinutes'),
    ])
  }

  let start: Date
  let end: Date
  if (tz) {
    const { dateOnlyToRange } = await import('../../mcp/tz-utils.ts')
    const dateStr = date.toISOString().slice(0, 10)
    const range = dateOnlyToRange(dateStr, tz)
    start = range.start
    end = range.end
  } else {
    start = new Date(date)
    start.setHours(0, 0, 0, 0)
    end = new Date(date)
    end.setHours(23, 59, 59, 999)
  }

  // Build category map for cross-source merge (cheap query, run before parallel block)
  const categoryMap = await buildCategoryMap(user)

  // Run queries in parallel
  const [
    heartRateData,
    stepsData,
    sleepSessions,
    allActivities,
    screentimeActivities,
    productivity,
    placeVisits,
    scoreMetrics,
    dayNotes,
    dayMeals,
    stepsAggregate,
    screentimeCategories,
    stressData,
  ] = await Promise.all([
    getTimeSeries(user, 'heart_rate', start, end),
    getTimeSeries(user, 'steps', start, end),
    getSleepSessions(user, start, end),
    getNonSleepActivitiesMerged(user, start, end, categoryMap),
    getScreentimeActivities(user, start, end),
    getProductivity(user, start, end),
    getPlaceVisits(user, start, end),
    getTimeSeriesMultiMetric(
      user,
      ['sleep_score', 'readiness_score', 'resilience_score', 'cardiovascular_age'],
      start,
      end,
    ),
    getNotesForTimeRange(user, start, end),
    getMeals(user, { start, end }),
    getDailyAggregateValue(user, 'steps', date),
    getScreentimeCategories(user),
    getTimeSeries(user, 'stress_level', start, end),
  ])

  // Calculate heart rate stats
  const heartRates = heartRateData.map(([, value]) => value)
  const heartRateStats: HeartRateStats | null =
    heartRates.length > 0
      ? {
          avg: Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length),
          count: heartRates.length,
          max: Math.max(...heartRates),
          min: Math.min(...heartRates),
        }
      : null

  // Get steps - prefer aggregate (deduplicated) over summing raw records
  const totalSteps =
    stepsAggregate !== null ? stepsAggregate : stepsData.reduce((sum, [, value]) => sum + value, 0)

  // Calculate productivity summary with category breakdown
  const excludedCategoryPaths = screentimeCategories
    .filter((c) => c.exclude_from_screentime)
    .map((c) => c.name)

  // Build category score lookup: JSON(name) -> score
  const categoryScoreMap = new Map<string, number>()
  for (const cat of screentimeCategories) {
    if (cat.score !== undefined) {
      categoryScoreMap.set(JSON.stringify(cat.name), cat.score)
    }
  }

  const productivitySummary: ProductivitySummary | null =
    productivity.length > 0
      ? (() => {
          const productivityCategoryMap = new Map<string, number>()
          const totals = {
            distracting_sec: 0,
            productive_sec: 0,
            total_duration_sec: 0,
            very_productive_sec: 0,
          }

          for (const record of productivity) {
            totals.total_duration_sec += record.duration_sec
            // Use record productivity, falling back to category score
            const score =
              record.productivity ?? categoryScoreMap.get(JSON.stringify(record.resolved_category ?? []))
            if (score !== undefined && score !== null) {
              if (score >= 1) totals.productive_sec += record.duration_sec
              if (score >= 2) totals.very_productive_sec += record.duration_sec
              if (score <= -1) totals.distracting_sec += record.duration_sec
            }
            const cat = record.resolved_category
            const isExcl =
              cat !== undefined &&
              excludedCategoryPaths.some(
                (excluded) => cat.length >= excluded.length && excluded.every((seg, i) => seg === cat[i]),
              )
            if (!isExcl) {
              const key = JSON.stringify(cat ?? [])
              productivityCategoryMap.set(key, (productivityCategoryMap.get(key) ?? 0) + record.duration_sec)
            }
          }

          const categories = [...productivityCategoryMap.entries()]
            .map(([key, duration_sec]) => ({ duration_sec, path: JSON.parse(key) as string[] }))
            .sort((a, b) => b.duration_sec - a.duration_sec)

          return { ...totals, categories }
        })()
      : null

  // Build scores object (get first value for each metric if available)
  const sleepScoreData = scoreMetrics['sleep_score']
  const readinessScoreData = scoreMetrics['readiness_score']
  const resilienceScoreData = scoreMetrics['resilience_score']
  const cardiovascularAgeData = scoreMetrics['cardiovascular_age']

  const hasAnyScoreData =
    sleepScoreData?.length ||
    readinessScoreData?.length ||
    resilienceScoreData?.length ||
    cardiovascularAgeData?.length

  const scores = hasAnyScoreData
    ? {
        cardiovascular_age: cardiovascularAgeData?.[0]?.[1] ?? null,
        readiness_score: readinessScoreData?.[0]?.[1] ?? null,
        resilience_score: resilienceScoreData?.[0]?.[1] ?? null,
        sleep_score: sleepScoreData?.[0]?.[1] ?? null,
      }
    : null

  // Get user's HR zones for exercise session HR zone calculation
  const { zones: hrZones } = await getEffectiveHrZones(user)

  // Fetch comments for all activities (generic exercises already absorbed at DB merge level)
  const activityIds = allActivities.map((a) => a.id).filter((id): id is string => id !== undefined)
  const commentsMap = await getCommentsMap(user, 'activity', activityIds)

  // Build unified activities array from DB activities (excludes screentime — handled separately)
  const activities: ActivitySummary[] = allActivities
    .filter((s) => s.activity_type !== 'screentime')
    .map((s) => {
      const dataObj = s.data as Record<string, unknown> | undefined
      const exerciseTypeCode = dataObj?.exerciseType
      const exerciseType =
        typeof exerciseTypeCode === 'number' ? getExerciseTypeName(exerciseTypeCode) : undefined

      const activity: ActivitySummary = {
        activity_type: s.activity_type,
        end_time: s.end_time?.toISOString(),
        start_time: s.start_time.toISOString(),
        title: s.title,
      }

      if (exerciseType) activity.exercise_type = exerciseType

      // Comments
      const comments = s.id ? commentsMap.get(s.id) : undefined
      if (comments && comments.length > 0) activity.comments = comments

      // HR zones for activities with time range
      if (s.end_time) {
        const sessionHrData = heartRateData.filter(([time]) => time >= s.start_time && time <= s.end_time!)
        if (sessionHrData.length > 0) {
          activity.hr_zone_secs = computeHrZoneSecs(sessionHrData, hrZones)
        }
      }

      // Stress zones for activities with time range
      if (s.end_time && stressData.length > 0) {
        const zones = computeStressZoneSecs(stressData, s.start_time, s.end_time)
        const hasStressData = zones.rest + zones.low + zones.medium + zones.high > 0
        if (hasStressData) activity.stress_zone_secs = zones
      }

      return activity
    })

  // Add screentime activities from the activities table, filtering excluded categories
  for (const s of screentimeActivities) {
    const categoryPathStr = (s.data as Record<string, unknown> | undefined)?.category_path as
      | string
      | undefined
    if (!categoryPathStr) continue

    const categoryPath = categoryPathStr.split(' > ')
    const isExcluded = excludedCategoryPaths.some(
      (excluded) =>
        categoryPath.length >= excluded.length && excluded.every((seg, i) => seg === categoryPath[i]),
    )
    if (isExcluded) continue

    const activity: ActivitySummary = {
      activity_type: 'screentime',
      category_path: categoryPath,
      end_time: s.end_time?.toISOString(),
      start_time: s.start_time.toISOString(),
      title: categoryPathStr,
    }

    // Stress zones for screentime spans
    if (s.end_time && stressData.length > 0) {
      const zones = computeStressZoneSecs(stressData, s.start_time, s.end_time)
      const hasStressData = zones.rest + zones.low + zones.medium + zones.high > 0
      if (hasStressData) activity.stress_zone_secs = zones
    }

    activities.push(activity)
  }

  // Sort all activities chronologically
  activities.sort((a, b) => a.start_time.localeCompare(b.start_time))

  // Day-level stress zones
  const stressZones: StressZoneSecs | null = stressData.length > 0 ? computeStressZoneSecs(stressData) : null

  // Build sleep session summaries with sleep_date and sleep_location
  const sleepSessionSummaries: SleepSessionSummary[] = sleepSessions.map((s) => {
    const timeInBed = s.end_time
      ? Math.round((s.end_time.getTime() - s.start_time.getTime()) / 1000 / 60)
      : undefined
    const totalSleep = computeSleepMinutes(s.data as Record<string, unknown> | undefined)

    const sleepDate = s.end_time
      ? s.end_time.toISOString().split('T')[0]
      : s.start_time.toISOString().split('T')[0]

    const sleepLocation = findSleepLocation(s.start_time, s.end_time ?? end, placeVisits)

    return {
      duration: totalSleep ?? timeInBed,
      end_time: s.end_time?.toISOString(),
      sleep_date: sleepDate,
      sleep_location: sleepLocation,
      sleep_stages: computeSleepStageSummary(s.data as Record<string, unknown> | undefined),
      start_time: s.start_time.toISOString(),
      time_in_bed: timeInBed,
      total_sleep: totalSleep,
    }
  })

  // Filter notes: only include orphaned notes (not attached to an activity in the list)
  const activityIdSet = new Set(activityIds)
  const orphanedNotes = dayNotes.filter(
    (n) => !(n.entity_type === 'activity' && n.entity_id && activityIdSet.has(n.entity_id)),
  )

  const dateStr = date.toISOString().split('T')[0]

  return {
    activities,
    date: dateStr,
    heart_rate: heartRateStats,
    meals: dayMeals.map((m) => ({
      calories: m.calories,
      carbs: m.carbs,
      fat: m.fat,
      fiber: m.fiber,
      food_items: m.food_items?.map((fi) => fi.name),
      meal_type: m.meal_type,
      name: m.name,
      protein: m.protein,
      time: m.time.toISOString(),
    })),
    notes: orphanedNotes.map((n) => ({
      content: n.content,
      created_at: n.created_at.toISOString(),
      end_time: n.end_time?.toISOString(),
      entity_id: n.entity_id,
      entity_type: n.entity_type,
      id: n.id,
      start_time: n.start_time?.toISOString(),
      updated_at: n.updated_at.toISOString(),
    })),
    scores,
    places: placeVisits
      .filter((p) => p.duration_minutes > 0)
      .map((p) => ({
        address: p.address,
        detected_location_id: p.detected_location_id,
        duration: p.duration_minutes,
        end_time: p.end_time.toISOString(),
        lat: p.lat,
        lon: p.lon,
        name: p.name,
        source: p.source,
        start_time: p.start_time.toISOString(),
      })),
    productivity: productivitySummary,
    sleep_sessions: sleepSessionSummaries,
    steps: { total: totalSteps },
    stress_zones: stressZones,
  }
}
