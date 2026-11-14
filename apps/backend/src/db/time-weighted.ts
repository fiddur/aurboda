export const TIME_WEIGHT_BIN_MINUTES = 5

/** Epoch-aligned 5-minute bins, the same bins `binSeries` makes. */
export const timeWeightBinSql = (column = 'time'): string =>
  `date_bin('${TIME_WEIGHT_BIN_MINUTES} minutes', ${column}, '2000-01-01T00:00:00Z'::timestamptz)`

export interface SampleRowsOptions {
  /** Grouping columns the outer query aggregates by, as `expr AS name` pairs. */
  keys: { expr: string; as: string }[]
  /** WHERE condition on `time_series`. */
  where: string
  timeWeighted: boolean
  /** Bin expression for the time-weighted rows; `timeWeightBinSql()` when omitted. */
  bin?: string
}

/**
 * A FROM item over `time_series` with the columns `keys…, value, value_sq, min_value, max_value,
 * sum_value, n, first_time, last_time, unit`, aggregated by `sampleAggregates`. Plain, it is one row
 * per sample. Time-weighted, it is one row per key and bin holding the bin's mean (`value`) and mean
 * square (`value_sq`), so an outer AVG weighs every bin alike however many samples it holds.
 */
export const sampleRowsSql = ({ bin, keys, timeWeighted, where }: SampleRowsOptions): string => {
  const keySelect = keys.map((k) => `${k.expr} AS ${k.as}, `).join('')
  if (!timeWeighted) {
    return `(SELECT ${keySelect}value, value * value AS value_sq, value AS min_value, value AS max_value,
            value AS sum_value, 1 AS n, time AS first_time, time AS last_time, unit
       FROM time_series
      WHERE ${where})`
  }
  const groupBy = [...keys.map((_, i) => String(i + 1)), bin ?? timeWeightBinSql()].join(', ')
  return `(SELECT ${keySelect}AVG(value) AS value, AVG(value * value) AS value_sq, MIN(value) AS min_value,
            MAX(value) AS max_value, SUM(value) AS sum_value, COUNT(*) AS n, MIN(time) AS first_time,
            MAX(time) AS last_time, MAX(unit) AS unit
       FROM time_series
      WHERE ${where}
      GROUP BY ${groupBy})`
}

/**
 * Aggregates over `sampleRowsSql` rows. Time-weighted, `stddev` is the population deviation with
 * every bin weighted alike: the mean over bins of the mean square, less the squared mean.
 */
export const sampleAggregates = (timeWeighted: boolean) => ({
  avg: 'AVG(value)',
  count: 'SUM(n)::integer',
  first_time: 'MIN(first_time)',
  last_time: 'MAX(last_time)',
  max: 'MAX(max_value)',
  min: 'MIN(min_value)',
  stddev: timeWeighted ? 'SQRT(GREATEST(AVG(value_sq) - AVG(value) ^ 2, 0))' : 'STDDEV_POP(value)',
  sum: 'SUM(sum_value)',
  unit: 'MAX(unit)',
})
