import type { MetricCatalogEntry } from '@aurboda/api-spec'

import { isComputedMetric } from '@aurboda/api-spec'

import type { CustomMetricDefinition } from '../state/api'

import { builtinDashboardMetricOptions } from '../utils/metricLabels'

export interface MetricEntry {
  value: string
  label: string
  group: 'builtin' | 'custom' | 'catalog'
  keywords?: string[]
}

/** The picker's entries. Where a value is entered (`writable`), the metrics Aurboda calculates are left out. */
export const buildMetricEntries = (
  customMetrics: CustomMetricDefinition[],
  catalogEntries: MetricCatalogEntry[],
  { writable }: { writable: boolean },
): MetricEntry[] => {
  const builtin: MetricEntry[] = builtinDashboardMetricOptions
    .filter((m) => !(writable && isComputedMetric(m.value)))
    .map((m) => ({ group: 'builtin', label: m.label, value: m.value }))

  const custom: MetricEntry[] = customMetrics.map((m) => ({
    group: 'custom',
    label: m.description ?? m.name,
    value: m.name,
  }))

  const catalog: MetricEntry[] = catalogEntries
    .filter((entry) => !entry.in_use)
    .map((entry) => ({
      group: 'catalog',
      keywords: entry.aliases,
      label: entry.display_name,
      value: entry.name,
    }))

  return [...builtin, ...custom, ...catalog]
}
