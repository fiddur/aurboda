import type { CustomMetricDefinition, MetricBetter } from '@aurboda/api-spec'

import { isValidMetric } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import { fetchCustomMetrics } from '../../state/api'
import { isPseudoMetric, widgetMetricBetter } from './trend'

/** The signed-in user's custom metric definitions, fetched only when `enabled`. */
export const useCustomMetricDefinitions = (enabled: boolean): CustomMetricDefinition[] =>
  useQuery({
    enabled,
    queryFn: fetchCustomMetrics,
    queryKey: ['customMetrics'],
    staleTime: 5 * 60 * 1000,
  }).data ?? []

/** The direction for the signed-in user's widget; custom metric definitions are fetched only for a custom metric. */
export const useMetricBetter = (metric: string, trendInverse?: boolean): MetricBetter => {
  const custom = !trendInverse && !isValidMetric(metric) && !isPseudoMetric(metric)
  return widgetMetricBetter(metric, useCustomMetricDefinitions(custom), trendInverse)
}
