import type { CustomMetricDefinition } from '@aurboda/api-spec'

import {
  deleteCustomMetricDefinition,
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  getCustomMetricByName,
  getCustomMetricDefinitions,
  insertCustomMetricDefinition,
  mergeCustomMetric,
  updateCustomMetricDefinition,
} from '../db/index.ts'
import { isValidMetric, metricUnits, type MetricType } from '../schema.ts'

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
  include_in_daily_summary?: boolean
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

export async function addCustomMetric(
  user: string,
  definition: CustomMetricDefinition,
): Promise<CustomMetricResult> {
  if (isValidMetric(definition.name)) {
    return {
      error: `Metric name "${definition.name}" conflicts with a built-in metric.`,
      success: false,
    }
  }

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
  const dbUpdates: Partial<
    Pick<
      CustomMetricDefinition,
      'unit' | 'description' | 'min_value' | 'max_value' | 'include_in_daily_summary'
    >
  > = {}

  if (updates.unit !== undefined) dbUpdates.unit = updates.unit
  if (updates.description !== undefined) dbUpdates.description = updates.description
  if (updates.minValue !== undefined) {
    dbUpdates.min_value = updates.minValue === null ? undefined : updates.minValue
  }
  if (updates.maxValue !== undefined) {
    dbUpdates.max_value = updates.maxValue === null ? undefined : updates.maxValue
  }
  if (updates.include_in_daily_summary !== undefined) {
    dbUpdates.include_in_daily_summary = updates.include_in_daily_summary
  }

  const updated = await updateCustomMetricDefinition(user, name, dbUpdates)
  if (!updated) {
    return { error: `Custom metric "${name}" not found.`, success: false }
  }

  return { data: updated, success: true }
}

/**
 * Delete a single metric measurement by metric name, time, and source (soft delete).
 */
export async function deleteMetric(
  user: string,
  metric: string,
  time: Date,
  source: string,
): Promise<DeleteMetricResult> {
  const deleted = await deleteTimeSeriesPoint(user, metric, time, source)

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

export async function getCustomMetrics(user: string): Promise<CustomMetricDefinition[]> {
  return getCustomMetricDefinitions(user)
}

export interface MergeCustomMetricResult {
  success: boolean
  error?: string
  rows_reassigned?: number
  rows_skipped?: number
}

/**
 * All time_series data is reassigned; the source definition is deleted.
 */
export async function mergeCustomMetricService(
  user: string,
  source: string,
  target: string,
): Promise<MergeCustomMetricResult> {
  if (source === target) {
    return { error: 'Source and target cannot be the same metric.', success: false }
  }

  const sourceMetric = await getCustomMetricByName(user, source)
  if (!sourceMetric) {
    return { error: `Custom metric "${source}" not found.`, success: false }
  }

  let targetUnit: string
  if (isValidMetric(target)) {
    targetUnit = metricUnits[target as MetricType]
  } else {
    const targetMetric = await getCustomMetricByName(user, target)
    if (!targetMetric) {
      return { error: `Target metric "${target}" does not exist.`, success: false }
    }
    targetUnit = targetMetric.unit
  }

  const result = await mergeCustomMetric(user, source, target, targetUnit)

  return {
    rows_reassigned: result.rows_reassigned,
    rows_skipped: result.rows_skipped,
    success: true,
  }
}
