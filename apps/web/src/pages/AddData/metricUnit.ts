import type { CustomMetricDefinition, MetricCatalogEntry } from '@aurboda/api-spec'

import { getMetricDisplayName, getMetricUnit } from '@aurboda/api-spec'

/** The units to offer for a catalogue metric: the user's own unit when it is none of them, then the stored unit and the other accepted units. */
export const catalogUnitOptions = (entry: MetricCatalogEntry): string[] => {
  const accepted = [entry.unit, ...entry.units.map((unit) => unit.unit)]
  return entry.in_use_unit !== undefined && !accepted.includes(entry.in_use_unit)
    ? [entry.in_use_unit, ...accepted]
    : accepted
}

export const defaultCatalogUnit = (entry: MetricCatalogEntry): string => entry.in_use_unit ?? entry.unit

/** The unit picked for this metric, else the default for a catalogue metric; undefined for any other metric. */
export const chosenCatalogUnit = (
  metric: string,
  entry: MetricCatalogEntry | undefined,
  choice: { metric: string; unit: string } | undefined,
): string | undefined => {
  if (!entry) return undefined
  return choice?.metric === metric ? choice.unit : defaultCatalogUnit(entry)
}

export const plainMetricUnit = (
  metric: string,
  customMetrics: CustomMetricDefinition[],
): string | undefined => getMetricUnit(metric, customMetrics)

export const metricLabel = (
  metric: string,
  customMetrics: CustomMetricDefinition[],
  catalogEntries: MetricCatalogEntry[],
): string =>
  catalogEntries.find((entry) => entry.name === metric)?.display_name ??
  customMetrics.find((m) => m.name === metric)?.description ??
  getMetricDisplayName(metric)
