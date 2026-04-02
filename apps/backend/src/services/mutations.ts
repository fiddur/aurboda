/**
 * Mutation services for health data.
 *
 * These functions contain the business logic for creating/updating health data.
 * They are used by both the MCP tools and the REST API.
 */

import type { ActivityType, CustomMetricDefinition, DataSource } from '@aurboda/api-spec'

import { randomUUID } from 'node:crypto'

import type { Activity } from '../db/types.ts'

import {
  deleteActivity as dbDeleteActivity,
  deleteTag as dbDeleteTag,
  getActivityById as dbGetActivityById,
  insertActivity as dbInsertActivity,
  updateActivity as dbUpdateActivity,
  enqueueOutboundSync,
  findHcRecordId,
  findMergeableTag,
  getTagById,
  insertTag,
  insertTimeSeries,
  resolveOrCreateTagDefinition,
  type TimeSeriesPoint,
  updateTag as dbUpdateTag,
  updateTagEndTime,
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
import { syncNoteTimesForEntity } from './notes.ts'

// ============================================================================
// Types
// ============================================================================

export interface AddTagInput {
  tag: string
  start_time: Date
  end_time?: Date
  mergeSpan?: number
}

export interface AddTagResult {
  success: boolean
  id: string
  tag: string
  start_time: string
  end_time?: string
  merged?: boolean
  extendedBySeconds?: number
}

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

export interface DeleteTagResult {
  success: boolean
  deleted: boolean
  external_id: string
}

export interface AddActivityInput {
  activity_type: ActivityType
  start_time: Date
  end_time: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
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
  start_time?: Date
  end_time?: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
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

/**
 * Add a manual tag/label to mark an activity or event.
 *
 * If mergeSpan is provided, attempts to merge with an existing tag of the same
 * name if its end_time (or start_time for point-in-time tags) is within
 * mergeSpan seconds of the new start_time.
 */
export async function addTag(user: string, input: AddTagInput): Promise<AddTagResult> {
  // If mergeSpan is specified, check for a mergeable tag
  if (input.mergeSpan !== undefined) {
    const existingTag = await findMergeableTag(user, input.tag, input.start_time, input.mergeSpan)

    if (existingTag && existingTag.external_id) {
      // Calculate the new end time - use new end_time if provided, otherwise use new start_time
      const newEndTime = input.end_time ?? input.start_time

      // Calculate the time extension
      const previousEnd = existingTag.end_time ?? existingTag.start_time
      const extendedBySeconds = Math.round((newEndTime.getTime() - previousEnd.getTime()) / 1000)

      await updateTagEndTime(user, existingTag.external_id, newEndTime)

      // Sync inherited times on any notes attached to this tag
      if (existingTag.id) {
        await syncNoteTimesForEntity(user, 'tag', existingTag.id, existingTag.start_time, newEndTime).catch(
          (err) => auditError(user, 'data', 'Failed to sync note times for tag', { error: String(err) }),
        )
      }

      return {
        end_time: newEndTime.toISOString(),
        extendedBySeconds,
        id: existingTag.id!,
        merged: true,
        start_time: existingTag.start_time.toISOString(),
        success: true,
        tag: existingTag.tag,
      }
    }
  }

  // Resolve or create a tag definition for this tag name
  const definition = await resolveOrCreateTagDefinition(user, input.tag)

  // Create a new tag
  const externalId = randomUUID()

  const dbId = await insertTag(user, {
    end_time: input.end_time,
    external_id: externalId,
    source: 'aurboda',
    start_time: input.start_time,
    tag: definition.name, // Use the canonical definition name
    tag_definition_id: definition.id,
  })

  return {
    end_time: input.end_time?.toISOString(),
    id: dbId,
    start_time: input.start_time.toISOString(),
    success: true,
    tag: input.tag,
    ...(input.mergeSpan !== undefined ? { merged: false } : {}),
  }
}

export interface UpdateTagInput {
  start_time?: Date
  end_time?: Date | null
}

export interface UpdateTagResult {
  success: boolean
  error?: string
}

export async function updateTag(user: string, id: string, input: UpdateTagInput): Promise<UpdateTagResult> {
  const existing = await getTagById(user, id)
  if (!existing) {
    return { error: 'Tag not found', success: false }
  }

  const finalStartTime = input.start_time ?? existing.start_time
  const finalEndTime = input.end_time === null ? undefined : (input.end_time ?? existing.end_time)

  if (finalEndTime && finalEndTime <= finalStartTime) {
    return { error: 'end_time must be after start_time', success: false }
  }

  const updates: { start_time?: Date; end_time?: Date | null } = {}
  if (input.start_time !== undefined) updates.start_time = input.start_time
  if (input.end_time !== undefined) updates.end_time = input.end_time

  await dbUpdateTag(user, id, updates)
  return { success: true }
}

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
 * Delete a tag by its external ID.
 */
export async function deleteTag(user: string, externalId: string): Promise<DeleteTagResult> {
  const deleted = await dbDeleteTag(user, externalId)

  return {
    deleted,
    external_id: externalId,
    success: deleted,
  }
}

/**
 * Add an activity (exercise, meditation, nap, etc.).
 *
 * Validates that end_time is after start_time.
 */
export async function addActivity(user: string, input: AddActivityInput): Promise<AddActivityResult> {
  // Validate that endTime is after startTime
  if (input.end_time <= input.start_time) {
    return {
      error: 'end_time must be after start_time',
      success: false,
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
            end_time: input.end_time.toISOString(),
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
    end_time: input.end_time.toISOString(),
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
 * Validates that if both start_time and end_time are provided, end_time is after start_time.
 * Also validates against existing values if only one is provided.
 */
// eslint-disable-next-line complexity -- note-sync adds one branch above the limit
export async function updateActivity(
  user: string,
  id: string,
  input: UpdateActivityInput,
): Promise<UpdateActivityResult> {
  // First, get the existing activity to validate times
  const existing = await dbGetActivityById(user, id)
  if (!existing) {
    return {
      error: 'Activity not found',
      id,
      success: false,
    }
  }

  // Determine final start and end times
  const finalStartTime = input.start_time ?? existing.start_time
  const finalEndTime = input.end_time ?? existing.end_time

  // Validate that endTime is after startTime
  if (finalEndTime && finalEndTime <= finalStartTime) {
    return {
      error: 'end_time must be after start_time',
      id,
      success: false,
    }
  }

  // Merge new data fields into existing data (preserving fields not being updated)
  const mergedData = input.data ? { ...(existing.data as Record<string, unknown>), ...input.data } : undefined

  const updated = await dbUpdateActivity(user, id, {
    data: mergedData,
    end_time: input.end_time,
    notes: input.notes,
    start_time: input.start_time,
    title: input.title,
  })

  if (!updated) {
    return {
      error: 'Failed to update activity',
      id,
      success: false,
    }
  }

  // Sync inherited times on any notes attached to this activity (best-effort)
  syncNoteTimesForEntity(user, 'activity', id, updated.start_time, updated.end_time ?? undefined).catch(
    (err) => auditError(user, 'data', 'Failed to sync note times for activity', { error: String(err) }),
  )

  // Enqueue outbound sync if this is an aurboda-owned HC-syncable activity (best-effort)
  try {
    if (updated.source === 'aurboda' && isHealthConnectSyncableActivity(updated.activity_type)) {
      const hcRecordType =
        activityTypeToHealthConnectType[updated.activity_type as keyof typeof activityTypeToHealthConnectType]
      if (hcRecordType) {
        await enqueueOutboundSync(user, {
          entity_id: id,
          entity_type: 'activity',
          hc_record_type: hcRecordType,
          operation: 'update',
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
      mergedData = { ...mergedData, ...(a.data as Record<string, unknown>) }
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
    insertActivity: (user: string, activity: Activity) => Promise<void>
    deleteActivity: (user: string, id: string) => Promise<boolean>
  } = {
    deleteActivity: dbDeleteActivity,
    getActivityById: dbGetActivityById,
    insertActivity: dbInsertActivity,
  },
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

  const id = randomUUID()

  await deps.insertActivity(user, {
    activity_type: sorted[0].activity_type,
    data: merged.data,
    end_time: merged.end_time,
    id,
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
export {
  deleteProductivity,
  deleteTagById,
  restoreActivity,
  restoreProductivity,
  restoreTag,
} from './restore.ts'
export type { RestoreResult } from './restore.ts'

// Re-export notes functions for backward compatibility
export { addNote, deleteNoteById, getNotesForEntity, updateNoteContent } from './notes.ts'
export type { AddNoteInput, NoteResult } from './notes.ts'
