/**
 * Mutation services for health data.
 *
 * These functions contain the business logic for creating/updating health data.
 * They are used by both the MCP tools and the REST API.
 */

import type { ActivityType, CustomMetricDefinition, DataSource } from '@aurboda/api-spec'

import { randomUUID } from 'node:crypto'

import type { Activity } from '../db/types.ts'
import type { ActivityNotifier } from './deduction-queue.ts'

import {
  activityTypeExists,
  checkActivityConflict,
  deleteActivity as dbDeleteActivity,
  findMergeableActivity,
  getActivityById as dbGetActivityById,
  getActivitySourcesByIds,
  getActivityTypeDefinition,
  getOverrideForActivity,
  insertActivity as dbInsertActivity,
  insertNewActivity as dbInsertNewActivity,
  insertOverride as dbInsertOverride,
  materializeSuperseded,
  updateActivity as dbUpdateActivity,
  enqueueOutboundSync,
  findHcRecordId,
  insertTimeSeries,
  type TimeSeriesPoint,
} from '../db/index.ts'
import {
  activityTypeToHealthConnectType,
  getMetricUnit,
  isHealthConnectSyncableActivity,
  isHealthConnectSyncableMetric,
  isValidMetric,
  isValidMetricOrCustom,
  metricToHealthConnectType,
} from '../schema.ts'
import { auditError } from './audit-log.ts'
import { getCustomMetrics } from './custom-metrics.ts'
import { validateActivityData } from './data-schema-validation.ts'
import { syncNoteTimesForEntity } from './notes.ts'

// ============================================================================
// Types
// ============================================================================

export interface AddMetricInput {
  metric: string
  value: number
  time: Date
}

export interface AddMetricResult {
  success: boolean
  error?: string
  metric: string
  value: number
  unit: string
  time: string
  entity_id?: string
}

export interface AddActivityInput {
  activity_type: ActivityType
  start_time: Date
  end_time?: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
  external_id?: string
  merge_span?: number
}

export interface AddActivityResult {
  success: boolean
  id?: string
  activity_type?: ActivityType
  start_time?: string
  end_time?: string
  title?: string
  notes?: string
  error?: string
}

export interface BulkMetricItem {
  metric: string
  value: number
  time: Date
  source?: string
}

export interface BulkMetricError {
  index: number
  error: string
}

export interface BulkAddMetricsResult {
  success: boolean
  inserted: number
  errors: BulkMetricError[]
}

export interface DeleteActivityResult {
  success: boolean
  deleted: boolean
  id: string
}

export interface UpdateActivityInput {
  activity_type?: ActivityType
  start_time?: Date
  end_time?: Date | null
  title?: string
  notes?: string
  data?: Record<string, unknown>
  /**
   * Multi-target override (#735): when the PATCH targets a synced activity
   * from a merged view, the caller passes the full list of source ids the
   * new override should claim. Includes `id` itself. When omitted, defaults
   * to `[id]` (single-target case).
   */
  override_target_ids?: string[]
}

export interface UpdateActivityResult {
  success: boolean
  id?: string
  activity_type?: ActivityType
  start_time?: string
  end_time?: string
  title?: string
  notes?: string
  error?: string
}

// ============================================================================
// Mutation Functions
// ============================================================================

/** Validate custom metric value range; returns error string if invalid, null if ok. */
function validateCustomMetricRange(
  customMetrics: CustomMetricDefinition[],
  metric: string,
  value: number,
): string | null {
  if (isValidMetric(metric)) return null
  const customDef = customMetrics.find((m) => m.name === metric)
  if (!customDef) return null
  if (customDef.min_value !== undefined && value < customDef.min_value) {
    return `Value ${value} is below minimum ${customDef.min_value} for metric "${metric}".`
  }
  if (customDef.max_value !== undefined && value > customDef.max_value) {
    return `Value ${value} exceeds maximum ${customDef.max_value} for metric "${metric}".`
  }
  return null
}

/**
 * Add a manual health metric measurement.
 * Supports both built-in and custom metrics.
 */
export async function addMetric(user: string, input: AddMetricInput): Promise<AddMetricResult> {
  const customMetrics = await getCustomMetrics(user)

  if (!isValidMetricOrCustom(input.metric, customMetrics)) {
    return {
      error: `Invalid metric "${input.metric}". Not a built-in or registered custom metric.`,
      metric: input.metric,
      success: false,
      time: input.time.toISOString(),
      unit: '',
      value: input.value,
    }
  }

  const unit = getMetricUnit(input.metric, customMetrics)

  const rangeError = validateCustomMetricRange(customMetrics, input.metric, input.value)
  if (rangeError) {
    return {
      error: rangeError,
      metric: input.metric,
      success: false,
      time: input.time.toISOString(),
      unit: unit ?? '',
      value: input.value,
    }
  }

  await insertTimeSeries(user, [
    {
      metric: input.metric,
      source: 'aurboda',
      time: input.time,
      unit,
      value: input.value,
    },
  ])

  // Enqueue outbound sync to Health Connect if applicable (best-effort, never fails the mutation)
  try {
    if (isHealthConnectSyncableMetric(input.metric)) {
      const hcRecordType = metricToHealthConnectType[input.metric as keyof typeof metricToHealthConnectType]
      if (hcRecordType) {
        await enqueueOutboundSync(user, {
          entity_id: `${input.metric}|${input.time.toISOString()}`,
          entity_type: 'time_series',
          hc_record_type: hcRecordType,
          operation: 'insert',
          payload: {
            metric: input.metric,
            time: input.time.toISOString(),
            unit,
            value: input.value,
          },
        })
      }
    }
  } catch (err) {
    auditError(user, 'data', 'Failed to enqueue outbound sync for metric', { error: String(err) })
  }

  const storedTime = input.time.toISOString()
  return {
    entity_id: `${storedTime}|${input.metric}|aurboda`,
    metric: input.metric,
    success: true,
    time: storedTime,
    unit: unit ?? '',
    value: input.value,
  }
}

/**
 * Bulk insert metric data points.
 *
 * Validates all items against built-in and custom metrics, collects per-item errors,
 * and inserts all valid items in a single batch call to insertTimeSeries.
 * Skips outbound Health Connect sync for bulk imports (historical data).
 */
export async function bulkAddMetrics(
  user: string,
  items: BulkMetricItem[],
  defaultSource?: string,
): Promise<BulkAddMetricsResult> {
  const customMetrics = await getCustomMetrics(user)

  const errors: BulkMetricError[] = []
  const validPoints: TimeSeriesPoint[] = []
  const resolvedDefaultSource: DataSource = (defaultSource as DataSource) ?? 'aurboda'

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (!isValidMetricOrCustom(item.metric, customMetrics)) {
      errors.push({ error: `Invalid metric "${item.metric}"`, index: i })
      continue
    }

    const rangeError = validateCustomMetricRange(customMetrics, item.metric, item.value)
    if (rangeError) {
      errors.push({ error: rangeError, index: i })
      continue
    }

    const unit = getMetricUnit(item.metric, customMetrics)
    const source: DataSource = (item.source as DataSource) ?? resolvedDefaultSource

    validPoints.push({
      metric: item.metric,
      source,
      time: item.time,
      unit,
      value: item.value,
    })
  }

  if (validPoints.length > 0) {
    await insertTimeSeries(user, validPoints)
  }

  return {
    errors,
    inserted: validPoints.length,
    success: true,
  }
}

/**
 * Validate activity data against the activity type's schema, if one is defined.
 * Returns an error string if validation fails, or undefined if it passes.
 */
const validateDataForType = async (
  user: string,
  activityType: string,
  data: Record<string, unknown> | undefined,
): Promise<string | undefined> => {
  const typeDef = await getActivityTypeDefinition(user, activityType)
  if (!typeDef?.data_schema) return undefined
  const validation = validateActivityData(data, typeDef.data_schema)
  if (!validation.valid) return `Data validation failed: ${validation.errors?.join(', ')}`
  return undefined
}

/**
 * Add an activity (exercise, meditation, nap, etc.).
 *
 * Validates that end_time is after start_time.
 */
// eslint-disable-next-line complexity -- notification callbacks add branches
export async function addActivity(
  user: string,
  input: AddActivityInput,
  onMutated?: ActivityNotifier,
): Promise<AddActivityResult> {
  // Validate activity type exists
  if (!(await activityTypeExists(user, input.activity_type))) {
    return {
      error: `Unknown activity type: "${input.activity_type}"`,
      success: false,
    }
  }

  // Validate data against activity type schema (if defined)
  const dataError = await validateDataForType(user, input.activity_type, input.data)
  if (dataError) return { error: dataError, success: false }

  // Validate that endTime is not before startTime (equal is valid for point-in-time activities)
  if (input.end_time && input.end_time < input.start_time) {
    return {
      error: 'end_time must not be before start_time',
      success: false,
    }
  }

  // If merge_span is specified, try to extend an existing activity instead of creating new
  if (input.merge_span) {
    const existing = await findMergeableActivity(
      user,
      input.activity_type,
      input.start_time,
      input.merge_span,
      undefined,
      input.data,
    )
    if (existing?.id) {
      const newEndTime = input.end_time ?? input.start_time
      await dbUpdateActivity(user, existing.id, { end_time: newEndTime })

      onMutated?.(user, existing.activity_type, existing.start_time, newEndTime)

      return {
        activity_type: existing.activity_type,
        end_time: newEndTime.toISOString(),
        id: existing.id,
        start_time: existing.start_time.toISOString(),
        success: true,
        title: existing.title,
      }
    }
  }

  const id = randomUUID()

  await dbInsertActivity(user, {
    activity_type: input.activity_type,
    data: input.data,
    end_time: input.end_time,
    id,
    notes: input.notes,
    source: 'aurboda',
    start_time: input.start_time,
    title: input.title,
  })

  onMutated?.(user, input.activity_type, input.start_time, input.end_time ?? input.start_time)

  // Enqueue outbound sync to Health Connect if applicable (best-effort, never fails the mutation)
  try {
    if (isHealthConnectSyncableActivity(input.activity_type)) {
      const hcRecordType =
        activityTypeToHealthConnectType[input.activity_type as keyof typeof activityTypeToHealthConnectType]
      if (hcRecordType) {
        await enqueueOutboundSync(user, {
          entity_id: id,
          entity_type: 'activity',
          hc_record_type: hcRecordType,
          operation: 'insert',
          payload: {
            activity_type: input.activity_type,
            data: input.data,
            end_time: input.end_time?.toISOString(),
            notes: input.notes,
            start_time: input.start_time.toISOString(),
            title: input.title,
          },
        })
      }
    }
  } catch (err) {
    auditError(user, 'data', 'Failed to enqueue outbound sync for activity', { error: String(err) })
  }

  return {
    activity_type: input.activity_type,
    end_time: input.end_time?.toISOString(),
    id,
    notes: input.notes,
    start_time: input.start_time.toISOString(),
    success: true,
    title: input.title,
  }
}

// Re-export custom metric management functions
export {
  addCustomMetric,
  deleteCustomMetric,
  deleteMetric,
  deleteMetricData,
  getCustomMetrics,
  updateCustomMetric,
} from './custom-metrics.ts'
export type {
  CustomMetricResult,
  DeleteCustomMetricResult,
  DeleteMetricDataResult,
  DeleteMetricResult,
  UpdateCustomMetricInput,
  UpdateCustomMetricResult,
} from './custom-metrics.ts'

/**
 * Delete an activity by its ID.
 */
export async function deleteActivity(user: string, id: string): Promise<DeleteActivityResult> {
  // Look up the activity before deleting to check if it needs HC sync
  const activity = await dbGetActivityById(user, id)
  const deleted = await dbDeleteActivity(user, id)

  // Recompute supersession — when a loser is deleted its winner row doesn't change,
  // but when a winner is deleted a previously-superseded sibling becomes the new winner.
  if (deleted && activity) {
    await materializeSuperseded(user, activity.start_time)
  }

  // Enqueue outbound delete if this was an aurboda-owned HC-syncable activity (best-effort)
  try {
    if (
      deleted &&
      activity &&
      activity.source === 'aurboda' &&
      isHealthConnectSyncableActivity(activity.activity_type)
    ) {
      const hcRecordType =
        activityTypeToHealthConnectType[
          activity.activity_type as keyof typeof activityTypeToHealthConnectType
        ]
      const hcRecordId = await findHcRecordId(user, 'activity', id)
      if (hcRecordType) {
        await enqueueOutboundSync(user, {
          entity_id: id,
          entity_type: 'activity',
          hc_record_type: hcRecordType,
          operation: 'delete',
          payload: { hc_record_id: hcRecordId },
        })
      }
    }
  } catch (err) {
    auditError(user, 'data', 'Failed to enqueue outbound sync for activity delete', { error: String(err) })
  }

  return {
    deleted,
    id,
    success: deleted,
  }
}

/**
 * Update an existing activity.
 *
 * For activities owned by aurboda (source='aurboda'), the row is updated in
 * place. For synced activities (garmin, health_connect, strava, oura, …), the
 * edit creates or updates a separate aurboda override row that wins in the
 * merged view and survives integration re-syncs (issue #715). Editing the
 * synced row directly would be reverted on the next sync.
 *
 * Validates that if both start_time and end_time are provided, end_time is
 * after start_time.
 */
// eslint-disable-next-line complexity -- override resolution adds branches; refactor candidate
export async function updateActivity(
  user: string,
  id: string,
  input: UpdateActivityInput,
  onMutated?: ActivityNotifier,
): Promise<UpdateActivityResult> {
  const target = await dbGetActivityById(user, id)
  if (!target) {
    return {
      error: 'Activity not found',
      id,
      success: false,
    }
  }

  // Resolve which row we'll actually mutate. For synced sources, prefer an
  // existing aurboda override targeting `target`; otherwise we'll create one.
  const isSyncedTarget = target.source !== 'aurboda'
  const existingOverride = isSyncedTarget ? await getOverrideForActivity(user, target.id!) : null
  const editRow = existingOverride ?? target
  // The "before" snapshot used for time/type comparisons — what the merged
  // view currently shows.
  const before = editRow

  const finalStartTime = input.start_time ?? before.start_time
  const finalEndTime = input.end_time === null ? null : (input.end_time ?? before.end_time)

  if (finalEndTime && finalEndTime < finalStartTime) {
    return {
      error: 'end_time must not be before start_time',
      id,
      success: false,
    }
  }

  const finalType = input.activity_type ?? before.activity_type
  const isTypeChanging = input.activity_type !== undefined && input.activity_type !== before.activity_type
  if (isTypeChanging && !(await activityTypeExists(user, input.activity_type!))) {
    return {
      error: `Unknown activity type: "${input.activity_type}"`,
      id,
      success: false,
    }
  }
  if (isTypeChanging) {
    // Conflict check is against the row we'll actually write — aurboda for
    // overrides (existing or new), or the same synced source for in-place edits.
    const writeSource = isSyncedTarget ? 'aurboda' : target.source
    const excludeId = existingOverride?.id ?? target.id!
    const conflict = await checkActivityConflict(
      user,
      writeSource,
      input.activity_type!,
      finalStartTime,
      excludeId,
    )
    if (conflict) {
      return {
        error: `Cannot change activity type: a ${input.activity_type} activity from ${writeSource} already exists at that start time`,
        id,
        success: false,
      }
    }
  }

  const mergedData = input.data ? { ...before.data, ...input.data } : before.data

  if (mergedData) {
    const dataError = await validateDataForType(user, finalType, mergedData)
    if (dataError) return { error: dataError, id, success: false }
  }

  let updated: Activity | null
  if (isSyncedTarget && !existingOverride) {
    // First user edit on a synced activity → create an aurboda override
    // carrying the synced row's snapshot overlaid with the user's input.
    // Mirror in-place semantics: input.notes / input.title === undefined keeps
    // the snapshot value; explicit '' (or null) clears it.
    //
    // Multi-target (#735): the caller may pass `override_target_ids` from a
    // merged-view edit so the new override claims all the merged source rows
    // at once. Always include `target.id` in the list (defaulting to just
    // that single source when the caller didn't pass anything).
    const targetIds = input.override_target_ids?.length
      ? Array.from(new Set([target.id!, ...input.override_target_ids]))
      : [target.id!]
    // Defensive check: targets must be synced (non-aurboda) rows. The web
    // client filters this client-side, but a buggy or non-web caller could
    // pass an aurboda id and create an "override of an override" the merge
    // logic isn't designed for.
    if (input.override_target_ids?.length) {
      const sources = await getActivitySourcesByIds(user, targetIds)
      const aurbodaTarget = sources.find((r) => r.source === 'aurboda')
      if (aurbodaTarget) {
        return {
          error: `override targets must be synced rows; ${aurbodaTarget.id} is an aurboda row`,
          id,
          success: false,
        }
      }
    }
    try {
      updated = await dbInsertOverride(user, targetIds, {
        activity_type: finalType,
        data: mergedData,
        end_time: input.end_time === null ? undefined : (finalEndTime ?? undefined),
        notes: input.notes !== undefined ? input.notes : target.notes,
        start_time: finalStartTime,
        title: input.title !== undefined ? input.title : target.title,
      })
    } catch (err) {
      // Race: a concurrent edit created the override first; the UNIQUE
      // constraint on `activity_override_targets.target_id` rejects ours.
      // Reload and apply the user's edits to the now-existing override
      // instead. (We probe the first target id; with one-override-per-target
      // any of them would resolve to the same row.)
      const code = (err as { code?: string }).code
      if (code !== '23505') throw err
      const concurrent = await getOverrideForActivity(user, targetIds[0])
      if (!concurrent) throw err
      updated = await dbUpdateActivity(user, concurrent.id!, {
        activity_type: input.activity_type,
        data: input.data ? mergedData : undefined,
        end_time: input.end_time,
        notes: input.notes,
        start_time: input.start_time,
        title: input.title,
      })
    }
  } else {
    updated = await dbUpdateActivity(user, editRow.id!, {
      activity_type: input.activity_type,
      data: input.data ? mergedData : undefined,
      end_time: input.end_time,
      notes: input.notes,
      start_time: input.start_time,
      title: input.title,
    })
  }

  if (!updated) {
    return {
      error: 'Failed to update activity',
      id,
      success: false,
    }
  }

  // Sync inherited times on any notes attached to either the row we wrote or
  // (for fresh overrides) any synced target — notes can be attached to any
  // of those ids and they should all track the new times.
  const noteEntityIds = updated.override_target_ids?.length
    ? [updated.id!, ...updated.override_target_ids]
    : [updated.id!]
  for (const noteEntityId of noteEntityIds) {
    syncNoteTimesForEntity(
      user,
      'activity',
      noteEntityId,
      updated.start_time,
      updated.end_time ?? undefined,
    ).catch((err) =>
      auditError(user, 'data', 'Failed to sync note times for activity', { error: String(err) }),
    )
  }

  await materializeSuperseded(user, updated.start_time)
  if (isTypeChanging || before.start_time.getTime() !== updated.start_time.getTime()) {
    await materializeSuperseded(user, before.start_time)
  }

  onMutated?.(user, updated.activity_type, updated.start_time, updated.end_time ?? updated.start_time)
  if (isTypeChanging) {
    onMutated?.(user, before.activity_type, before.start_time, before.end_time ?? before.start_time)
  }

  // Enqueue outbound HC sync only for aurboda activities that the user owns —
  // override rows (override_target_ids set) represent data that already
  // exists on the synced source, so pushing them to HC would create
  // duplicates.
  try {
    if (updated.source === 'aurboda' && !updated.override_target_ids?.length) {
      const oldWasSyncable = isHealthConnectSyncableActivity(before.activity_type)
      const newIsSyncable = isHealthConnectSyncableActivity(updated.activity_type)

      if (isTypeChanging && oldWasSyncable) {
        const oldHcType =
          activityTypeToHealthConnectType[
            before.activity_type as keyof typeof activityTypeToHealthConnectType
          ]
        const hcRecordId = await findHcRecordId(user, 'activity', updated.id!)
        if (oldHcType && hcRecordId) {
          await enqueueOutboundSync(user, {
            entity_id: updated.id!,
            entity_type: 'activity',
            hc_record_type: oldHcType,
            operation: 'delete',
            payload: { hc_record_id: hcRecordId },
          })
        }
      }

      if (newIsSyncable) {
        const hcRecordType =
          activityTypeToHealthConnectType[
            updated.activity_type as keyof typeof activityTypeToHealthConnectType
          ]
        if (hcRecordType) {
          await enqueueOutboundSync(user, {
            entity_id: updated.id!,
            entity_type: 'activity',
            hc_record_type: hcRecordType,
            operation: isTypeChanging ? 'insert' : 'update',
            payload: {
              activity_type: updated.activity_type,
              data: updated.data,
              end_time: updated.end_time?.toISOString(),
              notes: updated.notes,
              start_time: updated.start_time.toISOString(),
              title: updated.title,
            },
          })
        }
      }
    }
  } catch (err) {
    auditError(user, 'data', 'Failed to enqueue outbound sync for activity update', { error: String(err) })
  }

  return {
    activity_type: updated.activity_type,
    end_time: updated.end_time?.toISOString(),
    id: updated.id,
    notes: updated.notes,
    start_time: updated.start_time.toISOString(),
    success: true,
    title: updated.title,
  }
}

// ============================================================================
// Merge Activities
// ============================================================================

export interface MergeActivitiesInput {
  activity_ids: string[]
  title?: string
  notes?: string
}

export interface MergeActivitiesResult {
  success: boolean
  id?: string
  activity_type?: ActivityType
  start_time?: string
  end_time?: string
  title?: string
  notes?: string
  error?: string
}

/**
 * Build the merged data object from a list of activities sorted by start_time.
 * Pure function — easy to unit-test independently.
 */
export const buildMergedActivityData = (
  sortedActivities: Activity[],
  overrides?: { title?: string; notes?: string },
): {
  start_time: Date
  end_time: Date | undefined
  title: string | undefined
  notes: string | undefined
  data: Record<string, unknown>
} => {
  const startTime = sortedActivities[0].start_time
  let endTime: Date | undefined

  for (const a of sortedActivities) {
    if (a.end_time && (!endTime || a.end_time > endTime)) {
      endTime = a.end_time
    }
  }

  // Merge data objects: earlier first, later overrides
  let mergedData: Record<string, unknown> = {}
  for (const a of sortedActivities) {
    if (a.data) {
      mergedData = { ...mergedData, ...a.data }
    }
  }

  // Record provenance
  mergedData.merged_from = sortedActivities.map((a) => ({
    end_time: a.end_time?.toISOString(),
    id: a.id,
    source: a.source,
    start_time: a.start_time.toISOString(),
  }))

  // Title: override > first non-empty from sources
  const title = overrides?.title || sortedActivities.find((a) => a.title)?.title

  // Notes: override > concatenation
  const notes =
    overrides?.notes ||
    sortedActivities
      .filter((a) => a.notes)
      .map((a) => a.notes)
      .join('\n') ||
    undefined

  return { data: mergedData, end_time: endTime, notes, start_time: startTime, title }
}

/**
 * Permanently merge 2+ activities of the same type into one.
 *
 * Creates a new aurboda-owned activity spanning the full time range,
 * soft-deletes the originals, and stores merged_from metadata.
 */
export async function mergeActivities(
  user: string,
  input: MergeActivitiesInput,
  deps: {
    getActivityById: (user: string, id: string) => Promise<Activity | null>
    insertNewActivity: (user: string, activity: Activity) => Promise<string>
    deleteActivity: (user: string, id: string) => Promise<boolean>
    materializeSuperseded: (user: string, aroundTime: Date) => Promise<void>
  } = {
    deleteActivity: dbDeleteActivity,
    getActivityById: dbGetActivityById,
    insertNewActivity: dbInsertNewActivity,
    materializeSuperseded,
  },
  onMutated?: ActivityNotifier,
): Promise<MergeActivitiesResult> {
  if (input.activity_ids.length < 2) {
    return { error: 'At least 2 activity IDs are required', success: false }
  }

  // Fetch all activities
  const activities: Activity[] = []
  for (const id of input.activity_ids) {
    const activity = await deps.getActivityById(user, id)
    if (!activity) {
      return { error: `Activity not found: ${id}`, success: false }
    }
    if (activity.deleted_at) {
      return { error: `Activity is deleted: ${id}`, success: false }
    }
    activities.push(activity)
  }

  // Validate all same type
  const types = new Set(activities.map((a) => a.activity_type))
  if (types.size > 1) {
    return { error: `Cannot merge activities of different types: ${[...types].join(', ')}`, success: false }
  }

  // Sort by start_time
  const sorted = [...activities].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

  const merged = buildMergedActivityData(sorted, { notes: input.notes, title: input.title })

  const id = await deps.insertNewActivity(user, {
    activity_type: sorted[0].activity_type,
    data: merged.data,
    end_time: merged.end_time,
    id: randomUUID(),
    notes: merged.notes,
    source: 'aurboda',
    start_time: merged.start_time,
    title: merged.title,
  })

  // Soft-delete originals
  for (const activity of sorted) {
    if (activity.id) {
      await deps.deleteActivity(user, activity.id)
    }
  }

  // After the soft-delete + new aurboda insert, recompute supersession once.
  await deps.materializeSuperseded(user, merged.start_time)

  onMutated?.(user, sorted[0].activity_type, merged.start_time, merged.end_time ?? merged.start_time)

  return {
    activity_type: sorted[0].activity_type,
    end_time: merged.end_time?.toISOString(),
    id,
    notes: merged.notes,
    start_time: merged.start_time.toISOString(),
    success: true,
    title: merged.title,
  }
}

// Re-export restore and delete-by-id functions
export { deleteProductivity, restoreActivity, restoreProductivity } from './restore.ts'
export type { RestoreResult } from './restore.ts'

// Re-export notes functions for backward compatibility
export { addNote, deleteNoteById, getNotesForEntity, updateNoteContent } from './notes.ts'
export type { AddNoteInput, NoteResult } from './notes.ts'
