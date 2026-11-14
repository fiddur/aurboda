import type { CustomMetricDefinition, MetricCatalogEntry } from '@aurboda/api-spec'

import { catalogAcceptsUnit, getMetricDisplayName, getMetricUnit } from '@aurboda/api-spec'

/**
 * The units to offer for a catalogue metric: the stored unit and the other accepted units, after the user's own
 * unit when it is spelled as none of them. A unit of the user's the catalogue does not accept is the only one
 * offered, since a value in any other unit cannot be converted to it.
 */
export const catalogUnitOptions = (entry: MetricCatalogEntry): string[] => {
  const accepted = [entry.unit, ...entry.units.map((unit) => unit.unit)]
  const own = entry.in_use_unit
  if (own === undefined || accepted.includes(own)) return accepted
  return catalogAcceptsUnit(entry, own) ? [own, ...accepted] : [own]
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
