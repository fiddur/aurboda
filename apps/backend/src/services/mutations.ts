/**
 * Mutation services for health data.
 *
 * These functions contain the business logic for creating/updating health data.
 * They are used by both the MCP tools and the REST API.
 */

import { randomUUID } from 'crypto'
import { insertTag, insertTimeSeries } from '../db'
import { MetricType, metricUnits } from '../schema'

// ============================================================================
// Types
// ============================================================================

export interface AddTagInput {
  tag: string
  startTime: Date
  endTime?: Date
}

export interface AddTagResult {
  success: boolean
  id: string
  tag: string
  startTime: string
  endTime?: string
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

// ============================================================================
// Mutation Functions
// ============================================================================

/**
 * Add a manual tag/label to mark an activity or event.
 */
export async function addTag(user: string, input: AddTagInput): Promise<AddTagResult> {
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
