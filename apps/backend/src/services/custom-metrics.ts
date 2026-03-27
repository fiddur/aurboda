/**
 * Custom metric management — register, update, delete custom metrics and metric data.
 */

import type { CustomMetricDefinition } from '@aurboda/api-spec'

import {
  deleteCustomMetricDefinition,
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  getCustomMetricByName,
  getCustomMetricDefinitions,
  insertCustomMetricDefinition,
  updateCustomMetricDefinition,
} from '../db/index.ts'
import { isValidMetric } from '../schema.ts'

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

  // Check for duplicate
  const existing = await getCustomMetricByName(user, definition.name)
  if (existing) {
    return {
      error: `Custom metric "${definition.name}" already exists.`,
      success: false,
    }
  }

  await insertCustomMetricDefinition(user, definition)

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
  const deleted = await deleteCustomMetricDefinition(user, name)
  if (!deleted) {
    return { deleted: false, name, success: false }
  }

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
  const dbUpdates: Partial<Pick<CustomMetricDefinition, 'unit' | 'description' | 'min_value' | 'max_value'>> =
    {}

  if (updates.unit !== undefined) dbUpdates.unit = updates.unit
  if (updates.description !== undefined) dbUpdates.description = updates.description
  if (updates.minValue !== undefined) {
    dbUpdates.min_value = updates.minValue === null ? undefined : updates.minValue
  }
  if (updates.maxValue !== undefined) {
    dbUpdates.max_value = updates.maxValue === null ? undefined : updates.maxValue
  }

  const updated = await updateCustomMetricDefinition(user, name, dbUpdates)
  if (!updated) {
    return { error: `Custom metric "${name}" not found.`, success: false }
  }

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
  return getCustomMetricDefinitions(user)
}
