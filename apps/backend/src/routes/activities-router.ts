import type { RequestHandler } from 'express'

/**
 * Activities and productivity route group.
 *
 * Handles: /activities/*, /productivity
 */
import {
  type ActivitiesQuery,
  activitiesQuerySchema,
  type ActivitiesResponse,
  type ActivityDetailResponse,
  type AddActivityBody,
  type HrZoneSecs,
  addActivityBodySchema,
  type AddActivityResponse,
  type DeleteActivityResponse,
  type DistinctAppsResponse,
  getExerciseTypeValue,
  isValidExerciseType,
  type MergeActivitiesBody,
  mergeActivitiesBodySchema,
  type MergeActivitiesResponse,
  type NearbyActivitiesResponse,
  type ProductivityQuery,
  type ResyncActivityDetailResponse,
  productivityQuerySchema,
  type ProductivityRecordResponse,
  type ProductivityResponse,
  type ScreentimeBucketedQuery,
  screentimeBucketedQuerySchema,
  type ScreentimeBucketedResponse,
  type UpdateActivityBody,
  updateActivityBodySchema,
  type UpdateActivityResponse,
} from '@aurboda/api-spec'
import multer from 'multer'

import type { ActivityNotifier } from '../services/deduction-queue.ts'

import {
  getActivityById,
  getAllActivityTypeNames,
  getDeductionRule,
  getDistinctApps,
  getNearbyActivities,
  getOverlappingActivities,
  getProductivityBucketed,
  getProductivityById,
  getTimeSeries,
  insertTimeSeries,
  type TimeSeriesPoint,
} from '../db/index.ts'
import { httpError } from '../http-error.ts'
import { parseFitBuffer } from '../services/fit-parser.ts'
import {
  addActivity,
  deleteActivity,
  deleteProductivity,
  mergeActivities,
  restoreActivity,
  restoreProductivity,
  updateActivity,
} from '../services/mutations.ts'
import {
  assembleScreentimeBuckets,
  parseBucketSize,
  queryActivities,
  queryProductivity,
  type SyncProvider,
} from '../services/queries/index.ts'
import { computeHrZoneSecs, getEffectiveHrZones } from '../services/settings.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

/** Compute HR zone seconds and avg HRV for any activity time range. */
const computeActivityMetrics = async (
  user: string,
  start: Date,
  end: Date,
): Promise<{ hr_zone_secs?: HrZoneSecs; avg_hrv?: number }> => {
  const [hrData, { zones: hrZones }, hrvData] = await Promise.all([
    getTimeSeries(user, 'heart_rate', start, end),
    getEffectiveHrZones(user),
    getTimeSeries(user, 'hrv_rmssd', start, end),
  ])

  return {
    avg_hrv:
      hrvData.length > 0
        ? Math.round(hrvData.reduce((sum, [, v]) => sum + v, 0) / hrvData.length)
        : undefined,
    hr_zone_secs: hrData.length > 0 ? computeHrZoneSecs(hrData, hrZones) : undefined,
  }
}

type ActivityRow = Awaited<ReturnType<typeof getActivityById>> & {}

/** Build the merged activity detail response. */
const buildMergedResponse = async (
  user: string,
  activity: NonNullable<ActivityRow>,
  activityMetrics: { hr_zone_secs?: HrZoneSecs; avg_hrv?: number },
) => {
  const overlapping = await getOverlappingActivities(user, activity)
  const hasMultipleSources = overlapping.length > 1

  const sourceRecords = hasMultipleSources
    ? overlapping.map((a) => {
        const data = a.data as Record<string, unknown> | undefined
        return {
          data_origin: data?.dataOrigin as string | undefined,
          end_time: a.end_time?.toISOString(),
          exercise_type_name: data?.exerciseTypeName as string | undefined,
          id: a.id!,
          source: a.source,
          start_time: a.start_time.toISOString(),
          title: a.title,
        }
      })
    : undefined

  const mergedStartTime = hasMultipleSources
    ? new Date(Math.min(...overlapping.map((a) => a.start_time.getTime()))).toISOString()
    : undefined
  const mergedEndTime = hasMultipleSources
    ? new Date(Math.max(...overlapping.map((a) => (a.end_time ?? a.start_time).getTime()))).toISOString()
    : undefined

  const sorted = [...overlapping].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
  const mergedTitle = sorted.find((a) => a.title)?.title ?? activity.title
  const mergedNotes =
    sorted
      .map((a) => a.notes)
      .filter(Boolean)
      .join('\n') || activity.notes
  const mergedData = sorted.reduce<Record<string, unknown>>(
    (acc, a) => (a.data ? { ...acc, ...a.data } : acc),
    {},
  )

  // For merged activities, recompute HR zones using full merged time range
  let metrics = activityMetrics
  if (mergedStartTime && mergedEndTime) {
    metrics = await computeActivityMetrics(user, new Date(mergedStartTime), new Date(mergedEndTime))
  }

  return {
    activity_type: activity.activity_type,
    avg_hrv: metrics.avg_hrv,
    data: Object.keys(mergedData).length > 0 ? mergedData : activity.data,
    end_time: activity.end_time?.toISOString(),
    hr_zone_secs: metrics.hr_zone_secs,
    id: activity.id,
    merged_end_time: mergedEndTime,
    merged_start_time: mergedStartTime,
    notes: mergedNotes,
    source: activity.source,
    source_records: sourceRecords,
    start_time: activity.start_time.toISOString(),
    title: mergedTitle,
  }
}

export const createActivitiesRouter = (
  authMiddleware: RequestHandler,
  syncProvider?: SyncProvider,
  onActivityMutated?: ActivityNotifier,
  resyncActivityDetail?: (user: string, activityId: string, garminActivityId: number) => Promise<number>,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ActivitiesResponse, unknown, ActivitiesQuery>(
    '/activities',
    authMiddleware,
    validateQuery(activitiesQuerySchema),
    async (req, res) => {
      const {
        start,
        end,
        types: typesParam,
        exclude_types: excludeTypesParam,
        data_filter: dataFilterStr,
        deduction_rule_id: deductionRuleId,
      } = req.query
      const user = req.user!

      // When no types specified, query all activity types (not just those with definitions)
      let types = typesParam ? typesParam.split(',') : await getAllActivityTypeNames(user)

      // Filter out excluded types when specified
      if (excludeTypesParam) {
        const excludeSet = new Set(excludeTypesParam.split(','))
        types = types.filter((t) => !excludeSet.has(t))
      }

      // Parse data field filters (format: "field:value,field2:value2")
      const dataFilters = dataFilterStr
        ? dataFilterStr
            .split(',')
            .map((segment) => {
              const colonIdx = segment.indexOf(':')
              if (colonIdx === -1) return null
              const field = segment.slice(0, colonIdx).trim()
              const rawValue = segment.slice(colonIdx + 1).trim()
              return { field, value: rawValue === '(none)' ? null : rawValue }
            })
            .filter((f): f is { field: string; value: string | null } => f !== null)
        : undefined

      const activities = await queryActivities(
        user,
        types,
        new Date(start),
        new Date(end),
        syncProvider,
        dataFilters,
        deductionRuleId,
      )
      res.json({ data: activities, success: true })
    },
  )

  router.post<Record<string, never>, AddActivityResponse, AddActivityBody>(
    '/activities',
    authMiddleware,
    validateBody(addActivityBodySchema),
    async (req, res) => {
      const {
        activity_type,
        start_time,
        end_time,
        title,
        notes,
        exercise_type,
        merge_span,
        data: bodyData,
      } = req.body
      const user = req.user!

      const startDate = new Date(start_time)
      const endDate = end_time ? new Date(end_time) : undefined

      // Build data: merge body data with exercise_type conversion if provided
      let data: Record<string, unknown> | undefined = bodyData as Record<string, unknown> | undefined
      if (exercise_type !== undefined) {
        if (!isValidExerciseType(exercise_type)) {
          return res.status(400).json({
            error: `Invalid exercise_type "${exercise_type}"`,
            success: false,
          })
        }
        data = {
          ...data,
          exerciseType: getExerciseTypeValue(exercise_type),
          exerciseTypeName: exercise_type,
        }
      }

      const result = await addActivity(
        user,
        {
          activity_type,
          data,
          end_time: endDate,
          merge_span,
          notes,
          start_time: startDate,
          title,
        },
        onActivityMutated,
      )

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({
        data: {
          activity_type: result.activity_type!,
          end_time: result.end_time!,
          id: result.id!,
          notes: result.notes,
          start_time: result.start_time!,
          title: result.title,
        },
        success: true,
      })
    },
  )

  const upload = multer({
    limits: { fileSize: 10 * 1024 * 1024 },
    storage: multer.memoryStorage(),
  })

  router.post<
    Record<string, never>,
    { success: boolean; data?: AddActivityResponse['data'] | AddActivityResponse['data'][]; error?: string }
  >('/activities/upload-fit', authMiddleware, upload.single('fit_file'), async (req, res) => {
    const user = req.user!
    const file = req.file

    if (!file) {
      res.status(400).json({ error: 'No file uploaded', success: false })
      return
    }

    let fitActivities
    try {
      fitActivities = await parseFitBuffer(file.buffer.buffer as ArrayBuffer)
    } catch (error) {
      throw httpError(400, error instanceof Error ? error.message : 'Failed to parse FIT file')
    }

    const results: AddActivityResponse['data'][] = []

    for (const fitAct of fitActivities) {
      // Map exercise type name to Health Connect value
      const data = {
        ...fitAct.data,
        exerciseType: isValidExerciseType(fitAct.exercise_type)
          ? getExerciseTypeValue(fitAct.exercise_type)
          : undefined,
      }

      const result = await addActivity(
        user,
        {
          activity_type: fitAct.activity_type,
          data,
          end_time: fitAct.end_time,
          notes: fitAct.notes,
          start_time: fitAct.start_time,
          title: fitAct.title,
        },
        onActivityMutated,
      )

      if (!result.success) {
        res.status(400).json({ error: result.error, success: false })
        return
      }

      // Insert time series data (heart rate, power, cadence, speed)
      if (fitAct.timeSeries.length > 0 && result.id) {
        const points: TimeSeriesPoint[] = fitAct.timeSeries.map((ts) => ({
          metric: ts.metric,
          source: 'aurboda' as const,
          time: ts.time,
          value: ts.value,
        }))
        await insertTimeSeries(user, points)
      }

      results.push({
        activity_type: fitAct.activity_type,
        end_time: fitAct.end_time.toISOString(),
        id: result.id!,
        notes: fitAct.notes,
        start_time: fitAct.start_time.toISOString(),
        title: fitAct.title,
      })
    }

    res.json({
      data: results.length === 1 ? results[0] : results,
      success: true,
    })
  })

  router.post<Record<string, never>, MergeActivitiesResponse, MergeActivitiesBody>(
    '/activities/merge',
    authMiddleware,
    validateBody(mergeActivitiesBodySchema),
    async (req, res) => {
      const { activity_ids, title, notes } = req.body
      const user = req.user!

      const result = await mergeActivities(user, { activity_ids, notes, title }, undefined, onActivityMutated)

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({
        data: {
          activity_type: result.activity_type!,
          end_time: result.end_time,
          id: result.id,
          notes: result.notes,
          source: 'aurboda',
          start_time: result.start_time!,
          title: result.title,
        },
        success: true,
      })
    },
  )

  router.get<{ id: string }, NearbyActivitiesResponse>(
    '/activities/:id/nearby',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!
      const hours = Number(req.query.hours) || 6

      const activity = await getActivityById(user, id)
      if (!activity) {
        return res.status(404).json({ data: [], error: 'Activity not found', success: false })
      }

      const nearby = await getNearbyActivities(
        user,
        id,
        activity.activity_type,
        activity.start_time,
        activity.end_time,
        hours,
      )

      res.json({
        data: nearby.map((a) => ({
          activity_type: a.activity_type,
          data: a.data,
          end_time: a.end_time?.toISOString(),
          id: a.id,
          notes: a.notes,
          source: a.source,
          start_time: a.start_time.toISOString(),
          title: a.title,
        })),
        success: true,
      })
    },
  )

  router.delete<{ id: string }, DeleteActivityResponse>(
    '/activities/:id',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await deleteActivity(user, id)

      if (!result.success) {
        return res.status(404).json({ error: 'Activity not found', success: false })
      }

      res.json({ success: true })
    },
  )

  router.patch<{ id: string }, UpdateActivityResponse, UpdateActivityBody>(
    '/activities/:id',
    authMiddleware,
    validateBody(updateActivityBodySchema),
    async (req, res) => {
      const { id } = req.params
      const { activity_type, start_time, end_time, title, notes, exercise_type, data: bodyData } = req.body
      const user = req.user!

      // Merge exercise_type into data if provided
      let data: Record<string, unknown> | undefined = bodyData as Record<string, unknown> | undefined
      if (exercise_type !== undefined) {
        if (!isValidExerciseType(exercise_type)) {
          return res.status(400).json({
            error: `Invalid exercise_type "${exercise_type}"`,
            success: false,
          })
        }
        data = {
          ...data,
          exerciseType: getExerciseTypeValue(exercise_type),
          exerciseTypeName: exercise_type,
        }
      }

      const result = await updateActivity(
        user,
        id,
        {
          activity_type,
          data,
          end_time: end_time === null ? null : end_time ? new Date(end_time) : undefined,
          notes,
          start_time: start_time ? new Date(start_time) : undefined,
          title,
        },
        onActivityMutated,
      )

      if (!result.success) {
        const status = result.error === 'Activity not found' ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }

      res.json({
        data: {
          activity_type: result.activity_type!,
          end_time: result.end_time ?? undefined,
          id: result.id!,
          notes: result.notes,
          start_time: result.start_time!,
          title: result.title,
        },
        success: true,
      })
    },
  )

  // Supports merged: prefix -- merged:<uuid> returns merged view, plain uuid returns raw activity
  router.get<{ id: string }, ActivityDetailResponse>('/activities/:id', authMiddleware, async (req, res) => {
    const rawId = req.params.id
    const user = req.user!

    const isMerged = rawId.startsWith('merged:')
    const realId = isMerged ? rawId.slice('merged:'.length) : rawId

    const activity = await getActivityById(user, realId, true)
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found', success: false })
    }

    // Compute HR zones and avg HRV for any activity with a time range
    let activityMetrics: { hr_zone_secs?: HrZoneSecs; avg_hrv?: number } = {}
    if (activity.end_time) {
      activityMetrics = await computeActivityMetrics(user, activity.start_time, activity.end_time)
    }

    // For merged: prefix, fetch overlapping activities and return merged view
    if (isMerged && !activity.deleted_at) {
      const data = await buildMergedResponse(user, activity, activityMetrics)
      return res.json({ data, success: true })
    }

    // Resolve referenced deduction rules from activity data
    const referencedRules: Record<string, string> = {}
    const activityData = activity.data as Record<string, unknown> | undefined
    if (activityData) {
      const ruleIds = [
        typeof activityData._enriched_by === 'string' ? activityData._enriched_by : undefined,
        typeof activityData.rule_id === 'string' ? activityData.rule_id : undefined,
      ].filter((id): id is string => id !== undefined)

      for (const ruleId of ruleIds) {
        const rule = await getDeductionRule(user, ruleId)
        if (rule) referencedRules[ruleId] = rule.name
      }
    }

    // Plain UUID: return raw single activity (no overlap lookup)
    res.json({
      data: {
        activity_type: activity.activity_type,
        avg_hrv: activityMetrics.avg_hrv,
        data: activity.data,
        deleted_at: activity.deleted_at?.toISOString(),
        end_time: activity.end_time?.toISOString(),
        hr_zone_secs: activityMetrics.hr_zone_secs,
        id: activity.id,
        notes: activity.notes,
        source: activity.source,
        start_time: activity.start_time.toISOString(),
        title: activity.title,
      },
      referenced_rules: Object.keys(referencedRules).length > 0 ? referencedRules : undefined,
      success: true,
    })
  })

  router.post<{ id: string }, { success: boolean; error?: string }>(
    '/activities/:id/restore',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await restoreActivity(user, id)
      if (!result.success) {
        return res.status(404).json({ error: 'Activity not found or not deleted', success: false })
      }

      res.json({ success: true })
    },
  )

  router.get<Record<string, never>, ScreentimeBucketedResponse, unknown, ScreentimeBucketedQuery>(
    '/productivity/bucketed',
    authMiddleware,
    validateQuery(screentimeBucketedQuerySchema),
    async (req, res) => {
      const user = req.user!
      const { start, end, bucket, tz } = req.query
      const { interval, ms: bucketMs } = parseBucketSize(bucket)

      const rows = await getProductivityBucketed(user, new Date(start), new Date(end), interval, tz ?? 'UTC')
      const buckets = assembleScreentimeBuckets(rows, bucketMs)

      res.json({
        bucket: req.query.bucket,
        buckets,
        end,
        start,
        success: true,
      })
    },
  )

  router.get<Record<string, never>, DistinctAppsResponse>(
    '/productivity/apps',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const apps = await getDistinctApps(user)
      res.json({
        data: apps.map((a) => ({ ...a, last_seen: a.last_seen.toISOString() })),
        success: true,
      })
    },
  )

  router.get<{ id: string }, ProductivityRecordResponse>(
    '/productivity/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const record = await getProductivityById(user, req.params.id)
      if (!record) {
        return res.status(404).json({ error: 'Productivity record not found', success: false })
      }
      res.json({
        data: {
          activity: record.activity,
          category: record.category,
          device_name: record.device_name,
          duration_sec: record.duration_sec,
          end_time: record.end_time.toISOString(),
          id: record.id,
          is_mobile: record.is_mobile,
          productivity: record.productivity,
          resolved_category: record.resolved_category,
          source: record.source,
          start_time: record.start_time.toISOString(),
          title: record.title,
        },
        success: true,
      })
    },
  )

  router.delete<{ id: string }, { success: boolean; error?: string }>(
    '/productivity/:id',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await deleteProductivity(user, id)
      if (!result.success) {
        return res.status(404).json({ error: 'Productivity record not found', success: false })
      }

      res.json({ success: true })
    },
  )

  router.post<{ id: string }, { success: boolean; error?: string }>(
    '/productivity/:id/restore',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await restoreProductivity(user, id)
      if (!result.success) {
        return res.status(404).json({ error: 'Record not found or not deleted', success: false })
      }

      res.json({ success: true })
    },
  )

  router.post<{ id: string }, ResyncActivityDetailResponse>(
    '/activities/:id/resync-detail',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const { id } = req.params

      if (!resyncActivityDetail) {
        res.status(501).json({ points: 0, success: false, error: 'Garmin sync not configured' })
        return
      }

      const activity = await getActivityById(user, id)
      if (!activity) {
        res.status(404).json({ points: 0, success: false, error: 'Activity not found' })
        return
      }

      // Look for garmin_activity_id in this activity and its overlapping (merged) sources
      const getData = (a: { data?: unknown }) =>
        (a.data as Record<string, unknown> | undefined)?.garmin_activity_id as number | undefined

      let garminActivityId = getData(activity)
      let garminSourceId = activity.id!

      if (!garminActivityId) {
        const overlapping = await getOverlappingActivities(user, activity)
        for (const src of overlapping) {
          const gid = getData(src)
          if (gid) {
            garminActivityId = gid
            garminSourceId = src.id!
            break
          }
        }
      }

      if (!garminActivityId) {
        res.status(400).json({
          points: 0,
          success: false,
          error: 'No Garmin activity ID found in activity or its merged sources',
        })
        return
      }

      const points = await resyncActivityDetail(user, garminSourceId, garminActivityId)
      res.json({ points, success: true })
    },
  )

  router.get<Record<string, never>, ProductivityResponse, unknown, ProductivityQuery>(
    '/productivity',
    authMiddleware,
    validateQuery(productivityQuerySchema),
    async (req, res) => {
      const { start, end, merge_by, merge_gap_ms } = req.query
      const user = req.user!

      const gapMs = merge_gap_ms ? parseInt(merge_gap_ms, 10) : undefined
      const result = await queryProductivity(
        user,
        new Date(start),
        new Date(end),
        syncProvider,
        merge_by,
        gapMs,
      )
      res.json({ categories: result.categories, data: result.data, success: true })
    },
  )

  return router
}
