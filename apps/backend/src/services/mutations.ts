/**
 * Mutation services for health data.
 *
 * These functions contain the business logic for creating/updating health data.
 * They are used by both the MCP tools and the REST API.
 */

import type { ActivityType, EntityType as ApiEntityType, CustomMetricDefinition } from '@aurboda/api-spec'
import { randomUUID } from 'crypto'
import {
  deleteActivity as dbDeleteActivity,
  deleteNote as dbDeleteNote,
  deleteProductivityRecord as dbDeleteProductivityRecord,
  deleteTag as dbDeleteTag,
  deleteTagById as dbDeleteTagById,
  getActivityById as dbGetActivityById,
  getNotesForEntity as dbGetNotesForEntity,
  insertActivity as dbInsertActivity,
  insertNote as dbInsertNote,
  restoreActivity as dbRestoreActivity,
  restoreProductivityRecord as dbRestoreProductivityRecord,
  restoreTag as dbRestoreTag,
  updateActivity as dbUpdateActivity,
  updateNote as dbUpdateNote,
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  enqueueOutboundSync,
  findHcRecordId,
  findMergeableTag,
  getUserSettings,
  insertTag,
  insertTimeSeries,
  updateTagEndTime,
  upsertUserSettings,
  type EntityType,
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

export interface CustomMetricResult {
  success: boolean
  error?: string
  data?: CustomMetricDefinition
}

export interface DeleteCustomMetricResult {
  success: boolean
  deleted: boolean
  name: string
}

export interface UpdateCustomMetricInput {
  unit?: string
  description?: string
  minValue?: number | null
  maxValue?: number | null
}

export interface UpdateCustomMetricResult {
  success: boolean
  error?: string
  data?: CustomMetricDefinition
}

export interface DeleteMetricResult {
  success: boolean
  deleted: boolean
  metric: string
  time: string
}

export interface DeleteMetricDataResult {
  success: boolean
  metric: string
  deletedCount: number
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

  // Validate value range for custom metrics
  if (!isValidMetric(input.metric)) {
    const customDef = customMetrics.find((m) => m.name === input.metric)
    if (customDef) {
      if (customDef.min_value !== undefined && input.value < customDef.min_value) {
        return {
          error: `Value ${input.value} is below minimum ${customDef.min_value} for metric "${input.metric}".`,
          metric: input.metric,
          success: false,
          time: input.time.toISOString(),
          unit: unit ?? '',
          value: input.value,
        }
      }
      if (customDef.max_value !== undefined && input.value > customDef.max_value) {
        return {
          error: `Value ${input.value} exceeds maximum ${customDef.max_value} for metric "${input.metric}".`,
          metric: input.metric,
          success: false,
          time: input.time.toISOString(),
          unit: unit ?? '',
          value: input.value,
        }
      }
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

  // Enqueue outbound sync to Health Connect if applicable
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

  return {
    metric: input.metric,
    success: true,
    time: input.time.toISOString(),
    unit: unit ?? '',
    value: input.value,
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

  // Enqueue outbound sync to Health Connect if applicable
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

// ============================================================================
// Custom Metric Management
// ============================================================================

/**
 * Register a new custom metric type.
 */
export async function addCustomMetric(
  user: string,
  definition: CustomMetricDefinition,
): Promise<CustomMetricResult> {
  // Check name doesn't conflict with built-in metrics
  if (isValidMetric(definition.name)) {
    return {
      error: `Metric name "${definition.name}" conflicts with a built-in metric.`,
      success: false,
    }
  }

  const settings = await getUserSettings(user)
  const existing = settings?.custom_metrics ?? []

  // Check for duplicate
  if (existing.some((m) => m.name === definition.name)) {
    return {
      error: `Custom metric "${definition.name}" already exists.`,
      success: false,
    }
  }

  await upsertUserSettings(user, {
    custom_metrics: [...existing, definition],
  })

  return {
    data: definition,
    success: true,
  }
}

/**
 * Delete a custom metric definition.
 * Note: Existing time_series data for the metric is preserved.
 */
export async function deleteCustomMetric(user: string, name: string): Promise<DeleteCustomMetricResult> {
  const settings = await getUserSettings(user)
  const existing = settings?.custom_metrics ?? []

  const filtered = existing.filter((m) => m.name !== name)
  if (filtered.length === existing.length) {
    return { deleted: false, name, success: false }
  }

  await upsertUserSettings(user, { custom_metrics: filtered })

  return { deleted: true, name, success: true }
}

/**
 * Update a custom metric definition.
 * - `undefined` in input means "don't change"
 * - `null` for minValue/maxValue means "clear"
 */
export async function updateCustomMetric(
  user: string,
  name: string,
  updates: UpdateCustomMetricInput,
): Promise<UpdateCustomMetricResult> {
  const settings = await getUserSettings(user)
  const existing = settings?.custom_metrics ?? []

  const index = existing.findIndex((m) => m.name === name)
  if (index === -1) {
    return { error: `Custom metric "${name}" not found.`, success: false }
  }

  const current = existing[index]
  const updated: CustomMetricDefinition = {
    ...current,
    ...(updates.unit !== undefined && { unit: updates.unit }),
    ...(updates.description !== undefined && { description: updates.description }),
    ...(updates.minValue !== undefined && {
      min_value: updates.minValue === null ? undefined : updates.minValue,
    }),
    ...(updates.maxValue !== undefined && {
      max_value: updates.maxValue === null ? undefined : updates.maxValue,
    }),
  }

  const newMetrics = [...existing]
  newMetrics[index] = updated

  await upsertUserSettings(user, { custom_metrics: newMetrics })

  return { data: updated, success: true }
}

/**
 * Delete a single manual metric measurement by metric name and time.
 */
export async function deleteMetric(user: string, metric: string, time: Date): Promise<DeleteMetricResult> {
  const deleted = await deleteTimeSeriesPoint(user, metric, time)

  return {
    deleted,
    metric,
    success: deleted,
    time: time.toISOString(),
  }
}

/**
 * Delete all manual metric measurements for a given metric.
 */
export async function deleteMetricData(user: string, metric: string): Promise<DeleteMetricDataResult> {
  const deletedCount = await deleteTimeSeriesMetric(user, metric)

  return {
    deletedCount,
    metric,
    success: true,
  }
}

/**
 * Get all custom metric definitions for a user.
 */
export async function getCustomMetrics(user: string): Promise<CustomMetricDefinition[]> {
  const settings = await getUserSettings(user)
  return settings?.custom_metrics ?? []
}

/**
 * Delete an activity by its ID.
 */
export async function deleteActivity(user: string, id: string): Promise<DeleteActivityResult> {
  // Look up the activity before deleting to check if it needs HC sync
  const activity = await dbGetActivityById(user, id)
  const deleted = await dbDeleteActivity(user, id)

  // Enqueue outbound delete if this was an aurboda-owned HC-syncable activity
  if (
    deleted &&
    activity &&
    activity.source === 'aurboda' &&
    isHealthConnectSyncableActivity(activity.activity_type)
  ) {
    const hcRecordType =
      activityTypeToHealthConnectType[activity.activity_type as keyof typeof activityTypeToHealthConnectType]
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

  // Enqueue outbound sync if this is an aurboda-owned HC-syncable activity
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
// Restore Functions (soft-delete undo)
// ============================================================================

export interface RestoreResult {
  success: boolean
  restored: boolean
  id: string
}

export async function restoreActivity(user: string, id: string): Promise<RestoreResult> {
  const restored = await dbRestoreActivity(user, id)
  return { id, restored, success: restored }
}

export async function restoreTag(user: string, id: string): Promise<RestoreResult> {
  const restored = await dbRestoreTag(user, id)
  return { id, restored, success: restored }
}

export async function restoreProductivity(user: string, id: string): Promise<RestoreResult> {
  const restored = await dbRestoreProductivityRecord(user, id)
  return { id, restored, success: restored }
}

export async function deleteTagById(user: string, id: string): Promise<DeleteTagResult> {
  const deleted = await dbDeleteTagById(user, id)
  return { deleted, external_id: id, success: deleted }
}

export async function deleteProductivity(user: string, id: string): Promise<DeleteActivityResult> {
  const deleted = await dbDeleteProductivityRecord(user, id)
  return { deleted, id, success: deleted }
}

// ============================================================================
// Notes Functions
// ============================================================================

export interface AddNoteInput {
  entity_type: EntityType
  entity_id: string
  content: string
}

export interface NoteResult {
  success: boolean
  data?: {
    id: string
    entity_type: ApiEntityType
    entity_id: string
    content: string
    created_at: string
    updated_at: string
  }
  error?: string
}

export async function addNote(user: string, input: AddNoteInput): Promise<NoteResult> {
  const note = await dbInsertNote(user, input.entity_type, input.entity_id, input.content)
  return {
    data: {
      content: note.content,
      created_at: note.created_at.toISOString(),
      entity_id: note.entity_id,
      entity_type: note.entity_type,
      id: note.id,
      updated_at: note.updated_at.toISOString(),
    },
    success: true,
  }
}

export async function updateNoteContent(user: string, id: string, content: string): Promise<NoteResult> {
  const note = await dbUpdateNote(user, id, content)
  if (!note) {
    return { error: 'Note not found', success: false }
  }
  return {
    data: {
      content: note.content,
      created_at: note.created_at.toISOString(),
      entity_id: note.entity_id,
      entity_type: note.entity_type,
      id: note.id,
      updated_at: note.updated_at.toISOString(),
    },
    success: true,
  }
}

export async function deleteNoteById(
  user: string,
  id: string,
): Promise<{ success: boolean; deleted: boolean }> {
  const deleted = await dbDeleteNote(user, id)
  return { deleted, success: deleted }
}

export async function getNotesForEntity(user: string, entityType: ApiEntityType, entityId: string) {
  const notes = await dbGetNotesForEntity(user, entityType as EntityType, entityId)
  return notes.map((n) => ({
    content: n.content,
    created_at: n.created_at.toISOString(),
    entity_id: n.entity_id,
    entity_type: n.entity_type,
    id: n.id,
    updated_at: n.updated_at.toISOString(),
  }))
}
