import { isTimeWeightedMetric } from '@aurboda/api-spec'

import { binSeries } from './correlations/impact.ts'
import { mean } from './correlations/utils.ts'

/**
 * The mean of `metric`'s samples: for a time-weighted metric the mean of their 5-minute bin means
 * (the in-memory counterpart of `sampleRowsSql`), otherwise the plain mean. Null without samples.
 */
export const sampleMean = (metric: string, data: [Date, number][]): number | null =>
  mean(isTimeWeightedMetric(metric) ? binSeries(data).values : data.map(([, value]) => value))
