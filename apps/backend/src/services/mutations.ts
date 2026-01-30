/**
 * Mutation services for health data.
 *
 * These functions contain the business logic for creating/updating health data.
 * They are used by both the MCP tools and the REST API.
 */

import { randomUUID } from 'crypto'
import {
  deleteTag as dbDeleteTag,
  findMergeableTag,
  insertTag,
  insertTimeSeries,
  updateTagEndTime,
} from '../db'
import { MetricType, metricUnits } from '../schema'

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
  metric: MetricType
  value: number
  time: Date
}

export interface AddMetricResult {
  success: boolean
  metric: MetricType
  value: number
  unit: string
  time: string
}

export interface DeleteTagResult {
  success: boolean
  deleted: boolean
  externalId: string
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
 */
export async function addMetric(user: string, input: AddMetricInput): Promise<AddMetricResult> {
  await insertTimeSeries(user, [
    {
      metric: input.metric,
      source: 'manual',
      time: input.time,
      value: input.value,
    },
  ])

  const unit = metricUnits[input.metric]

  return {
    metric: input.metric,
    success: true,
    time: input.time.toISOString(),
    unit,
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
