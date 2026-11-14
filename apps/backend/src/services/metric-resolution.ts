import type { CustomMetricDefinition, StoredMetricCatalog, StoredMetricCatalogEntry } from '@aurboda/api-spec'

import { isValidMetric, metricUnits } from '../schema.ts'
import {
  catalogUnitSpellings,
  convertCatalogValue,
  findCatalogMetric,
  getCatalogMetric,
  sameUnit,
} from './metric-catalog.ts'

export interface ResolvedMetric {
  metric: string
  unit: string
  entry?: StoredMetricCatalogEntry
  adopt: boolean
}

/**
 * A built-in metric first, then the user's custom metric of exactly that name, then a catalogue entry by
 * name, display name or alias (the user's metric of the entry's name when they have one, else the entry to
 * be adopted).
 */
export const resolveMetricForWrite = (
  name: string,
  customMetrics: CustomMetricDefinition[],
  catalog: StoredMetricCatalog,
): ResolvedMetric | undefined => {
  if (isValidMetric(name)) return { adopt: false, metric: name, unit: metricUnits[name] }
  const custom = customMetrics.find((m) => m.name === name)
  if (custom) {
    const entry = getCatalogMetric(catalog, name)
    return { adopt: false, metric: name, unit: custom.unit, ...(entry ? { entry } : {}) }
  }
  const entry = findCatalogMetric(catalog, name)
  if (!entry) return undefined
  const own = customMetrics.find((m) => m.name === entry.name)
  return own
    ? { adopt: false, entry, metric: entry.name, unit: own.unit }
    : { adopt: true, entry, metric: entry.name, unit: entry.unit }
}

const unitError = (resolved: ResolvedMetric, givenUnit: string): string =>
  resolved.entry
    ? `Unit "${givenUnit}" is not accepted for "${resolved.metric}", which is stored in ${resolved.unit}. Accepted units: ${catalogUnitSpellings(resolved.entry).join(', ')}.`
    : `Unit "${givenUnit}" does not match "${resolved.metric}", which is stored in ${resolved.unit}.`

/** The value in the resolved metric's unit; left without a unit, the value is taken to be in it already. */
export const valueForWrite = (
  resolved: ResolvedMetric,
  value: number,
  givenUnit: string | undefined,
): { value: number } | { error: string } => {
  if (givenUnit === undefined || sameUnit(givenUnit, resolved.unit)) return { value }
  const converted = resolved.entry
    ? convertCatalogValue(resolved.entry, value, givenUnit, resolved.unit)
    : undefined
  return converted === undefined ? { error: unitError(resolved, givenUnit) } : { value: converted }
}
