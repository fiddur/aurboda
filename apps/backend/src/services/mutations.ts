/**
 * Mutation services for health data.
 *
 * These functions contain the business logic for creating/updating health data.
 * They are used by both the MCP tools and the REST API.
 */

import type { ActivityType, CustomMetricDefinition } from '@aurboda/api-spec'
import { randomUUID } from 'crypto'
import {
  deleteActivity as dbDeleteActivity,
  deleteTag as dbDeleteTag,
  getActivityById as dbGetActivityById,
  insertActivity as dbInsertActivity,
  updateActivity as dbUpdateActivity,
  findMergeableTag,
  getUserSettings,
  insertTag,
  insertTimeSeries,
  updateTagEndTime,
  upsertUserSettings,
} from '../db'
import { getMetricUnit, isValidMetric, isValidMetricOrCustom } from '../schema'

// ============================================================================
// Types
// ============================================================================

export interface AddTagInput {
  tag: string
  startTime: Date
  endTime?: Date
  mergeSpan?: number
}

export interface AddTagResult {
  success: boolean
  id: string
  tag: string
  startTime: string
  endTime?: string
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
  externalId: string
}

export interface AddActivityInput {
  activityType: ActivityType
  startTime: Date
  endTime: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
}

export interface AddActivityResult {
  success: boolean
  id?: string
  activityType?: ActivityType
  startTime?: string
  endTime?: string
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

export interface DeleteActivityResult {
  success: boolean
  deleted: boolean
  id: string
}

export interface UpdateActivityInput {
  startTime?: Date
  endTime?: Date
  title?: string
  notes?: string
}

export interface UpdateActivityResult {
  success: boolean
  id?: string
  activityType?: ActivityType
  startTime?: string
  endTime?: string
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
    const existingTag = await findMergeableTag(user, input.tag, input.startTime, input.mergeSpan)

    if (existingTag && existingTag.externalId) {
      // Calculate the new end time - use new end_time if provided, otherwise use new start_time
      const newEndTime = input.endTime ?? input.startTime

      // Calculate the time extension
      const previousEnd = existingTag.endTime ?? existingTag.startTime
      const extendedBySeconds = Math.round((newEndTime.getTime() - previousEnd.getTime()) / 1000)

      await updateTagEndTime(user, existingTag.externalId, newEndTime)

      return {
        endTime: newEndTime.toISOString(),
        extendedBySeconds,
        id: existingTag.externalId,
        merged: true,
        startTime: existingTag.startTime.toISOString(),
        success: true,
        tag: existingTag.tag,
      }
    }
  }

  // Create a new tag
  const externalId = randomUUID()

  await insertTag(user, {
    endTime: input.endTime,
    externalId,
    source: 'manual',
    startTime: input.startTime,
    tag: input.tag,
  })

  return {
    endTime: input.endTime?.toISOString(),
    id: externalId,
    startTime: input.startTime.toISOString(),
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
  const customMetrics = settings?.customMetrics ?? []

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
      if (customDef.minValue !== undefined && input.value < customDef.minValue) {
        return {
          error: `Value ${input.value} is below minimum ${customDef.minValue} for metric "${input.metric}".`,
          metric: input.metric,
          success: false,
          time: input.time.toISOString(),
          unit: unit ?? '',
          value: input.value,
        }
      }
      if (customDef.maxValue !== undefined && input.value > customDef.maxValue) {
        return {
          error: `Value ${input.value} exceeds maximum ${customDef.maxValue} for metric "${input.metric}".`,
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
      source: 'manual',
      time: input.time,
      unit,
      value: input.value,
    },
  ])

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
    externalId,
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
  if (input.endTime <= input.startTime) {
    return {
      error: 'end_time must be after start_time',
      success: false,
    }
  }

  const id = randomUUID()

  await dbInsertActivity(user, {
    activityType: input.activityType,
    data: input.data,
    endTime: input.endTime,
    id,
    notes: input.notes,
    source: 'manual',
    startTime: input.startTime,
    title: input.title,
  })

  return {
    activityType: input.activityType,
    endTime: input.endTime.toISOString(),
    id,
    notes: input.notes,
    startTime: input.startTime.toISOString(),
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
  const existing = settings?.customMetrics ?? []

  // Check for duplicate
  if (existing.some((m) => m.name === definition.name)) {
    return {
      error: `Custom metric "${definition.name}" already exists.`,
      success: false,
    }
  }

  await upsertUserSettings(user, {
    customMetrics: [...existing, definition],
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
  const existing = settings?.customMetrics ?? []

  const filtered = existing.filter((m) => m.name !== name)
  if (filtered.length === existing.length) {
    return { deleted: false, name, success: false }
  }

  await upsertUserSettings(user, { customMetrics: filtered })

  return { deleted: true, name, success: true }
}

/**
 * Get all custom metric definitions for a user.
 */
export async function getCustomMetrics(user: string): Promise<CustomMetricDefinition[]> {
  const settings = await getUserSettings(user)
  return settings?.customMetrics ?? []
}

/**
 * Delete an activity by its ID.
 */
export async function deleteActivity(user: string, id: string): Promise<DeleteActivityResult> {
  const deleted = await dbDeleteActivity(user, id)

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
  const finalStartTime = input.startTime ?? existing.startTime
  const finalEndTime = input.endTime ?? existing.endTime

  // Validate that endTime is after startTime
  if (finalEndTime && finalEndTime <= finalStartTime) {
    return {
      error: 'end_time must be after start_time',
      id,
      success: false,
    }
  }

  const updated = await dbUpdateActivity(user, id, {
    endTime: input.endTime,
    notes: input.notes,
    startTime: input.startTime,
    title: input.title,
  })

  if (!updated) {
    return {
      error: 'Failed to update activity',
      id,
      success: false,
    }
  }

  return {
    activityType: updated.activityType,
    endTime: updated.endTime?.toISOString(),
    id: updated.id,
    notes: updated.notes,
    startTime: updated.startTime.toISOString(),
    success: true,
    title: updated.title,
  }
}
