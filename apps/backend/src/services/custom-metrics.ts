import type {
  AddCustomMetricBody,
  CustomMetricDefinition,
  MetricAggregation,
  MetricBetter,
  MetricCatalogResult,
  StoredMetricCatalog,
} from '@aurboda/api-spec'

import { sameUnit } from '@aurboda/api-spec'

import {
  adoptCatalogMetric,
  type CustomMetricDefinitionUpdates,
  deleteCustomMetricDefinition,
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  getCustomMetricByName,
  getCustomMetricDefinitions,
  insertCustomMetricDefinition,
  mergeCustomMetric,
  type Queryable,
  updateCustomMetricDefinition,
  withUserTransaction,
} from '../db/index.ts'
import { isValidMetric, metricUnits, type MetricType } from '../schema.ts'
import {
  findCatalogMetric,
  getCatalogMetric,
  loadMetricCatalog,
  searchMetricCatalog,
  toMetricCatalogEntry,
} from './metric-catalog.ts'

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
  aggregation?: MetricAggregation
  better?: MetricBetter
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

const adoptionRace = (message: string): Error => Object.assign(new Error(message), { adoption_race: true })

const isAdoptionRace = (err: unknown): err is Error => err instanceof Error && 'adoption_race' in err

/**
 * Runs `write` in one transaction with the adoption of the catalogue metrics it writes to, so a write that fails
 * adopts nothing. The values were converted to each definition's unit: when a metric of that name was created
 * in another unit after the caller read the user's metrics, nothing is written and the error says so.
 */
export const writeWithCatalogAdoption = async <T>(
  user: string,
  definitions: CustomMetricDefinition[],
  write: (tx: Queryable) => Promise<T>,
): Promise<{ error: string } | { result: T }> => {
  try {
    const result = await withUserTransaction(user, async (tx) => {
      for (const definition of definitions) {
        const unit = await adoptCatalogMetric(tx, definition)
        if (!sameUnit(unit, definition.unit)) {
          throw adoptionRace(
            `Metric "${definition.name}" was just added in ${unit}, not ${definition.unit}: nothing was written. Try again.`,
          )
        }
      }
      return write(tx)
    })
    return { result }
  } catch (err) {
    if (isAdoptionRace(err)) return { error: err.message }
    throw err
  }
}

const catalogAliasHint = (catalog: StoredMetricCatalog, name: string): string | undefined => {
  if (getCatalogMetric(catalog, name)) return undefined
  const entry = findCatalogMetric(catalog, name)
  return entry
    ? `"${name}" is the built-in metric "${entry.name}" (stored in ${entry.unit}): add values under that name, which adds it on first use.`
    : undefined
}

export async function addCustomMetric(
  user: string,
  { separate_metric, ...definition }: AddCustomMetricBody,
  catalog: StoredMetricCatalog = loadMetricCatalog(),
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

  const hint = separate_metric === true ? undefined : catalogAliasHint(catalog, definition.name)
  if (hint) {
    return {
      error: `${hint} Pass separate_metric: true to create a separate custom metric anyway.`,
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
  const dbUpdates: CustomMetricDefinitionUpdates = {}

  if (updates.unit !== undefined) dbUpdates.unit = updates.unit
  if (updates.description !== undefined) dbUpdates.description = updates.description
  if (updates.minValue !== undefined) dbUpdates.min_value = updates.minValue
  if (updates.maxValue !== undefined) dbUpdates.max_value = updates.maxValue
  if (updates.include_in_daily_summary !== undefined) {
    dbUpdates.include_in_daily_summary = updates.include_in_daily_summary
  }
  if (updates.aggregation !== undefined) dbUpdates.aggregation = updates.aggregation
  if (updates.better !== undefined) dbUpdates.better = updates.better

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

export const listMetricCatalog = async (
  user: string,
  q?: string,
  catalog: StoredMetricCatalog = loadMetricCatalog(),
): Promise<MetricCatalogResult> => {
  const metrics = new Map((await getCustomMetricDefinitions(user)).map((metric) => [metric.name, metric]))
  return {
    entries: searchMetricCatalog(catalog, q).map((entry) =>
      toMetricCatalogEntry(entry, metrics.get(entry.name)),
    ),
    groups: catalog.groups,
    version: catalog.version,
  }
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
