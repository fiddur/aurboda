import { isTimeWeightedMetric } from '@aurboda/api-spec'

import { binSeries } from './correlations/impact.ts'
import { mean } from './correlations/utils.ts'

/**
 * The values an average of `metric`'s samples is taken over: for a time-weighted metric their
 * 5-minute bin means (the in-memory counterpart of `sampleRowsSql`), otherwise the samples.
 */
export const meanValues = (metric: string, data: [Date, number][]): number[] =>
  isTimeWeightedMetric(metric) ? binSeries(data).values : data.map(([, value]) => value)

/** The mean of `meanValues`. Null without samples. */
export const sampleMean = (metric: string, data: [Date, number][]): number | null =>
  mean(meanValues(metric, data))
