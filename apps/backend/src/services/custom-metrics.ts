/**
 * Custom metric management — register, update, delete custom metrics and metric data.
 */

import type { CustomMetricDefinition } from '@aurboda/api-spec'

import {
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  getUserSettings,
  upsertUserSettings,
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
