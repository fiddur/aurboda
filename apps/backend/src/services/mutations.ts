/**
 * Mutation services for health data.
 *
 * These functions contain the business logic for creating/updating health data.
 * They are used by both the MCP tools and the REST API.
 */

import type { ActivityType, CustomMetricDefinition, DataSource } from '@aurboda/api-spec'
import { randomUUID } from 'crypto'
import {
  deleteActivity as dbDeleteActivity,
  deleteTag as dbDeleteTag,
  getActivityById as dbGetActivityById,
  insertActivity as dbInsertActivity,
  updateActivity as dbUpdateActivity,
  enqueueOutboundSync,
  findHcRecordId,
  findMergeableTag,
  getUserSettings,
  insertTag,
  insertTimeSeries,
  type TimeSeriesPoint,
  updateTagEndTime,
} from '../db'
import {
  activityTypeToHealthConnectType,
  getMetricUnit,
  isHealthConnectSyncableActivity,
  isHealthConnectSyncableMetric,
  isValidMetric,
  isValidMetricOrCustom,
  metricToHealthConnectType,
} from '../schema'
import { syncNoteTimesForEntity } from './notes'

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
          (err) => console.error('Failed to sync note times for tag:', err),
        )
      }

      return {
        end_time: newEndTime.toISOString(),
        extendedBySeconds,
        id: existingTag.external_id,
        merged: true,
        start_time: existingTag.start_time.toISOString(),
        success: true,
        tag: existingTag.tag,
      }
    }
  }

  // Create a new tag
  const externalId = randomUUID()

  await insertTag(user, {
    end_time: input.end_time,
    external_id: externalId,
    source: 'aurboda',
    start_time: input.start_time,
    tag: input.tag,
  })

  return {
    end_time: input.end_time?.toISOString(),
    id: externalId,
    start_time: input.start_time.toISOString(),
    success: true,
    tag: input.tag,
    ...(input.mergeSpan !== undefined ? { merged: false } : {}),
  }
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
  const settings = await getUserSettings(user)
  const customMetrics = settings?.custom_metrics ?? []

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
          payload: { metric: input.metric, time: input.time.toISOString(), unit, value: input.value },
        })
      }
    }
  } catch (err) {
    console.error('Failed to enqueue outbound sync for metric:', err)
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
  const settings = await getUserSettings(user)
  const customMetrics = settings?.custom_metrics ?? []

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
    console.error('Failed to enqueue outbound sync for activity:', err)
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
} from './custom-metrics'
export type {
  CustomMetricResult,
  DeleteCustomMetricResult,
  DeleteMetricDataResult,
  DeleteMetricResult,
  UpdateCustomMetricInput,
  UpdateCustomMetricResult,
} from './custom-metrics'

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
    console.error('Failed to enqueue outbound sync for activity delete:', err)
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
  const mergedData =
    input.data ? { ...((existing.data as Record<string, unknown>) ?? {}), ...input.data } : undefined

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
    (err) => console.error('Failed to sync note times for activity:', err),
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
    console.error('Failed to enqueue outbound sync for activity update:', err)
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

// Re-export restore and delete-by-id functions
export {
  deleteProductivity,
  deleteTagById,
  restoreActivity,
  restoreProductivity,
  restoreTag,
} from './restore'
export type { RestoreResult } from './restore'

// Re-export notes functions for backward compatibility
export { addNote, deleteNoteById, getNotesForEntity, updateNoteContent } from './notes'
export type { AddNoteInput, NoteResult } from './notes'
