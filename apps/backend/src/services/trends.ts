/**
 * Trends service for calculating time-weighted averages using Exponential Moving Average (EMA).
 *
 * EMA gives more weight to recent data while still smoothing over a configurable period.
 * The half-life parameter controls how quickly the weight decays - after half-life days,
 * an event's weight drops to 50%.
 */

import {
  type CustomMetricDefinition,
  displayPeriodMultipliers,
  type MetricType,
  type TrendDisplayPeriod,
  type TrendHistoryPoint,
  type TrendResult,
  type TrendSourceType,
} from '@aurboda/api-spec'

import { query } from '../db/index.ts'

/**
 * Natural log of 2, used for EMA decay calculation.
 * exp(-LN2 * days / halfLife) gives weight that drops to 50% after halfLife days.
 */
const LN2 = 0.693147

export interface GetTrendInput {
  activity_type_id?: string
  aggregation?: 'count' | 'mean' | 'sum'
  breakdown_fields?: string[]
  custom_metrics?: CustomMetricDefinition[]
  display_period?: TrendDisplayPeriod
  half_life_days?: number
  lookback_days?: number
  pattern: string
  source_type: TrendSourceType
  /** @deprecated Use activity_type_id instead */
  tag_definition_id?: string
}

/**
 * Calculate the EMA-weighted trend for a metric.
 *
 * For metrics, we use the mean value per day weighted by EMA.
 */
const calculateMetricTrend = async (
  user: string,
  metric: MetricType,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  aggregation: 'mean' | 'sum',
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = aggregation === 'sum' ? displayPeriodMultipliers[displayPeriod] : 1
  const warmupDays = lookbackDays + 3 * halfLifeDays

  const result = await query(
    user,
    `
    WITH date_range AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '1 day' * $6::integer,
        CURRENT_DATE,
        '1 day'
      )::date AS day
    ),
    daily_values AS (
      SELECT
        d.day,
        t.daily_value
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', time AT TIME ZONE 'UTC')::date as day,
          ${aggregation === 'sum' ? 'SUM(value)' : 'AVG(value)'} as daily_value
        FROM time_series
        WHERE metric = $1
          AND time > CURRENT_DATE - INTERVAL '1 day' * ($6::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dv.day,
        $4::float * SUM(dv2.daily_value * EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)) /
        NULLIF(SUM(CASE WHEN dv2.daily_value IS NOT NULL THEN EXP(-$3::float * (dv.day - dv2.day)::float / $5::float) ELSE 0 END), 0) as ema_value
      FROM daily_values dv
      CROSS JOIN LATERAL (
        SELECT day, daily_value
        FROM daily_values
        WHERE day <= dv.day AND day > dv.day - INTERVAL '1 day' * 90
      ) dv2
      GROUP BY dv.day
    )
    SELECT day, ema_value
    FROM ema_calc
    WHERE day >= CURRENT_DATE - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    [metric, lookbackDays, LN2, multiplier, halfLifeDays, warmupDays],
  )

  const history: TrendHistoryPoint[] = result.rows
    .filter((row) => row.ema_value !== null)
    .map((row) => ({
      date: row.day.toISOString().split('T')[0],
      value: Number(row.ema_value),
    }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
}

/**
 * Calculate the EMA-weighted trend for time spent in a productivity category.
 *
 * Aggregates daily total duration (in hours) of productivity records whose
 * resolved_category path starts with the given category path, then applies EMA.
 * Pattern is the category path joined by ' > ', e.g. "Work > Programming".
 */
const calculateProductivityCategoryTrend = async (
  user: string,
  categoryPath: string,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = displayPeriodMultipliers[displayPeriod]
  const warmupDays = lookbackDays + 3 * halfLifeDays

  const result = await query(
    user,
    `
    WITH date_range AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '1 day' * $6::integer,
        CURRENT_DATE,
        '1 day'
      )::date AS day
    ),
    daily_values AS (
      SELECT
        d.day,
        t.daily_hours
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', start_time AT TIME ZONE 'UTC')::date as day,
          SUM(duration_sec) / 3600.0 as daily_hours
        FROM productivity
        WHERE deleted_at IS NULL
          AND resolved_category IS NOT NULL
          AND array_to_string(resolved_category, ' > ') LIKE $1 || '%'
          AND start_time > CURRENT_DATE - INTERVAL '1 day' * ($6::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dv.day,
        $4::float * SUM(COALESCE(dv2.daily_hours, 0) * EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)) /
        NULLIF(SUM(EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)), 0) as ema_value
      FROM daily_values dv
      CROSS JOIN LATERAL (
        SELECT day, daily_hours
        FROM daily_values
        WHERE day <= dv.day AND day > dv.day - INTERVAL '1 day' * 90
      ) dv2
      GROUP BY dv.day
    )
    SELECT day, COALESCE(ema_value, 0) as ema_value
    FROM ema_calc
    WHERE day >= CURRENT_DATE - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    [categoryPath, lookbackDays, LN2, multiplier, halfLifeDays, warmupDays],
  )

  const history: TrendHistoryPoint[] = result.rows.map((row) => ({
    date: row.day.toISOString().split('T')[0],
    value: Number(row.ema_value),
  }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
}

/**
 * Calculate the EMA-weighted trend for an activity type.
 *
 * Queries the activities table for activities matching the given activity_type.
 * Sums duration in hours per day, then applies EMA weighting.
 * Pattern is the activity type name (e.g. "yoga", "running", "coffee").
 */
const calculateActivityTypeTrend = async (
  user: string,
  pattern: string,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = displayPeriodMultipliers[displayPeriod]
  const warmupDays = lookbackDays + 3 * halfLifeDays

  const result = await query(
    user,
    `
    WITH date_range AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '1 day' * $6::integer,
        CURRENT_DATE,
        '1 day'
      )::date AS day
    ),
    daily_values AS (
      SELECT
        d.day,
        t.daily_hours
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', start_time AT TIME ZONE 'UTC')::date as day,
          SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 3600.0 as daily_hours
        FROM activities
        WHERE activity_type = $1
          AND deleted_at IS NULL
          AND start_time > CURRENT_DATE - INTERVAL '1 day' * ($6::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dv.day,
        $4::float * SUM(COALESCE(dv2.daily_hours, 0) * EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)) /
        NULLIF(SUM(EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)), 0) as ema_value
      FROM daily_values dv
      CROSS JOIN LATERAL (
        SELECT day, daily_hours
        FROM daily_values
        WHERE day <= dv.day AND day > dv.day - INTERVAL '1 day' * 90
      ) dv2
      GROUP BY dv.day
    )
    SELECT day, COALESCE(ema_value, 0) as ema_value
    FROM ema_calc
    WHERE day >= CURRENT_DATE - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    [pattern, lookbackDays, LN2, multiplier, halfLifeDays, warmupDays],
  )

  const history: TrendHistoryPoint[] = result.rows.map((row) => ({
    date: row.day.toISOString().split('T')[0],
    value: Number(row.ema_value),
  }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
}

/**
 * Calculate the EMA-weighted trend for activity type count (for count-based types like tags).
 *
 * Counts occurrences per day instead of summing duration.
 */
const calculateActivityTypeCountTrend = async (
  user: string,
  pattern: string,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = displayPeriodMultipliers[displayPeriod]
  const warmupDays = lookbackDays + 3 * halfLifeDays

  const result = await query(
    user,
    `
    WITH date_range AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '1 day' * $6::integer,
        CURRENT_DATE,
        '1 day'
      )::date AS day
    ),
    daily_counts AS (
      SELECT
        d.day,
        COALESCE(t.cnt, 0) as cnt
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', start_time AT TIME ZONE 'UTC')::date as day,
          count(*) as cnt
        FROM activities
        WHERE activity_type = $1
          AND deleted_at IS NULL
          AND start_time > CURRENT_DATE - INTERVAL '1 day' * ($6::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dc.day,
        $4::float * SUM(dc2.cnt::float * EXP(-$3::float * (dc.day - dc2.day)::float / $5::float)) /
        NULLIF(SUM(EXP(-$3::float * (dc.day - dc2.day)::float / $5::float)), 0) as ema_value
      FROM daily_counts dc
      CROSS JOIN LATERAL (
        SELECT day, cnt
        FROM daily_counts
        WHERE day <= dc.day AND day > dc.day - INTERVAL '1 day' * 90
      ) dc2
      GROUP BY dc.day
    )
    SELECT day, COALESCE(ema_value, 0) as ema_value
    FROM ema_calc
    WHERE day >= CURRENT_DATE - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    [pattern, lookbackDays, LN2, multiplier, halfLifeDays, warmupDays],
  )

  const history: TrendHistoryPoint[] = result.rows.map((row) => ({
    date: row.day.toISOString().split('T')[0],
    value: Number(row.ema_value),
  }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
}

/**
 * Compute EMA over daily values using the same formula as the SQL-based functions.
 * For each day, ema = multiplier * sum(value_i * weight_i) / sum(weight_i)
 * where weight_i = exp(-LN2 * daysAgo / halfLife) and the lookback window is
 * min(lookbackDays, 90).
 */
/**
 * @param displayStartIdx Index in `days` where the display range starts. EMA is computed
 *   from index 0 (warmup period) but only points from displayStartIdx onward are returned.
 */
const computeEma = (
  dailyValues: Map<string, number>,
  days: string[],
  halfLifeDays: number,
  multiplier: number,
  displayStartIdx = 0,
): TrendHistoryPoint[] => {
  const history: TrendHistoryPoint[] = []

  for (let i = 0; i < days.length; i++) {
    let weightedSum = 0
    let weightSum = 0
    const currentDay = new Date(days[i]).getTime()

    for (let j = i; j >= 0 && i - j <= 90; j--) {
      const pastDay = new Date(days[j]).getTime()
      const daysAgo = (currentDay - pastDay) / (1000 * 60 * 60 * 24)
      const weight = Math.exp((-LN2 * daysAgo) / halfLifeDays)
      const value = dailyValues.get(days[j]) ?? 0
      weightedSum += value * weight
      weightSum += weight
    }

    if (weightSum > 0 && i >= displayStartIdx) {
      history.push({ date: days[i], value: (multiplier * weightedSum) / weightSum })
    }
  }

  return history
}

/**
 * Calculate EMA-weighted trend for an activity type broken down by one or more data fields.
 * Groups daily values by breakdown field, then computes EMA independently per series.
 */
const calculateActivityTypeBreakdownTrend = async (
  user: string,
  pattern: string,
  breakdownFields: string[],
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  aggregation: 'count' | 'sum',
): Promise<{ series: string[]; histories: Record<string, TrendHistoryPoint[]> }> => {
  for (const field of breakdownFields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) return { histories: {}, series: [] }
  }

  const multiplier = displayPeriodMultipliers[displayPeriod]
  const fieldSelects = breakdownFields.map((f, i) => `COALESCE(data->>'${f}', '(none)') AS field_${i}`)
  const fieldGroupBys = breakdownFields.map((_, i) => `field_${i}`)
  const valueExpr =
    aggregation === 'count'
      ? 'count(*)'
      : "SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, start_time + interval '1 hour') - start_time))) / 3600.0"

  const warmupDays = lookbackDays + 3 * halfLifeDays
  const result = await query(
    user,
    `SELECT date_trunc('day', start_time AT TIME ZONE 'UTC')::date AS day,
            ${fieldSelects.join(', ')},
            ${valueExpr} AS value
       FROM activities
      WHERE activity_type = $1
        AND deleted_at IS NULL
        AND start_time > CURRENT_DATE - INTERVAL '1 day' * ($2::integer + 1)
      GROUP BY 1, ${fieldGroupBys.join(', ')}
      ORDER BY 1`,
    [pattern, warmupDays],
  )

  // Build per-series daily values
  const seriesDaily = new Map<string, Map<string, number>>()
  for (const row of result.rows) {
    const keyParts = breakdownFields.map((_, i) => row[`field_${i}`] as string)
    const seriesKey = keyParts.join(' / ')
    const day = (row.day as Date).toISOString().split('T')[0]
    const value = Number(row.value)

    if (!seriesDaily.has(seriesKey)) seriesDaily.set(seriesKey, new Map())
    seriesDaily.get(seriesKey)!.set(day, value)
  }

  // Generate full date range including warmup period
  const warmupCount = 3 * halfLifeDays
  const days: string[] = []
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  for (let d = warmupDays; d >= 0; d--) {
    const date = new Date(now)
    date.setUTCDate(date.getUTCDate() - d)
    days.push(date.toISOString().split('T')[0])
  }

  // Compute EMA per series — warmup period is excluded from output
  const displayStartIdx = warmupCount
  const series = [...seriesDaily.keys()].sort()
  const histories: Record<string, TrendHistoryPoint[]> = {}
  for (const s of series) {
    histories[s] = computeEma(seriesDaily.get(s)!, days, halfLifeDays, multiplier, displayStartIdx)
  }

  return { histories, series }
}

const displayUnits: Record<TrendDisplayPeriod, string> = {
  daily: 'per day',
  monthly: 'per month',
  weekly: 'per week',
}

/** Build the activity_type trend result, with optional breakdown. */
const getActivityTypeTrend = async (
  user: string,
  input: GetTrendInput & { aggregation: 'count' | 'mean' | 'sum' },
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
): Promise<TrendResult> => {
  const effectiveAggregation = input.aggregation === 'mean' ? 'sum' : input.aggregation
  const displayUnit =
    effectiveAggregation === 'count' ? displayUnits[displayPeriod] : `hours ${displayUnits[displayPeriod]}`

  if (input.breakdown_fields?.length) {
    const breakdown = await calculateActivityTypeBreakdownTrend(
      user,
      input.pattern,
      input.breakdown_fields,
      halfLifeDays,
      lookbackDays,
      displayPeriod,
      effectiveAggregation,
    )

    return {
      aggregation: effectiveAggregation,
      breakdown_histories: breakdown.histories,
      breakdown_series: breakdown.series,
      current_value: 0,
      display_period: displayPeriod,
      display_unit: displayUnit,
      half_life_days: halfLifeDays,
      history: [],
      lookback_days: lookbackDays,
      pattern: input.pattern,
      source_type: 'activity_type',
    }
  }

  const { currentValue, history } =
    effectiveAggregation === 'count'
      ? await calculateActivityTypeCountTrend(user, input.pattern, halfLifeDays, lookbackDays, displayPeriod)
      : await calculateActivityTypeTrend(user, input.pattern, halfLifeDays, lookbackDays, displayPeriod)

  return {
    aggregation: effectiveAggregation,
    current_value: currentValue,
    display_period: displayPeriod,
    display_unit: displayUnit,
    half_life_days: halfLifeDays,
    history,
    lookback_days: lookbackDays,
    pattern: input.pattern,
    source_type: 'activity_type',
  }
}

/**
 * Get the trend for a tag pattern, metric, productivity category, or activity type.
 */
export const getTrend = async (user: string, input: GetTrendInput): Promise<TrendResult> => {
  const {
    aggregation = 'count',
    display_period: displayPeriod = 'monthly',
    half_life_days: halfLifeDays = 15,
    lookback_days: lookbackDays = 90,
    pattern,
    source_type: sourceType,
  } = input

  if (sourceType === 'tag') {
    // 'tag' is a backward-compat alias for activity_type count trend
    const { currentValue, history } = await calculateActivityTypeCountTrend(
      user,
      pattern,
      halfLifeDays,
      lookbackDays,
      displayPeriod,
    )

    return {
      aggregation: 'count',
      current_value: currentValue,
      display_period: displayPeriod,
      display_unit: displayUnits[displayPeriod],
      half_life_days: halfLifeDays,
      history,
      lookback_days: lookbackDays,
      pattern,
      source_type: sourceType,
    }
  } else if (sourceType === 'activity_type') {
    return getActivityTypeTrend(user, { ...input, aggregation }, halfLifeDays, lookbackDays, displayPeriod)
  } else if (sourceType === 'productivity_category') {
    const { currentValue, history } = await calculateProductivityCategoryTrend(
      user,
      pattern,
      halfLifeDays,
      lookbackDays,
      displayPeriod,
    )

    return {
      aggregation: 'sum',
      current_value: currentValue,
      display_period: displayPeriod,
      display_unit: `hours ${displayUnits[displayPeriod]}`,
      half_life_days: halfLifeDays,
      history,
      lookback_days: lookbackDays,
      pattern,
      source_type: sourceType,
    }
  } else {
    // Metric source
    const metricAggregation = aggregation === 'count' ? 'mean' : aggregation

    const { currentValue, history } = await calculateMetricTrend(
      user,
      pattern as MetricType,
      halfLifeDays,
      lookbackDays,
      displayPeriod,
      metricAggregation,
    )

    return {
      aggregation: metricAggregation,
      current_value: currentValue,
      display_period: displayPeriod,
      display_unit: metricAggregation === 'sum' ? displayUnits[displayPeriod] : '',
      half_life_days: halfLifeDays,
      history,
      lookback_days: lookbackDays,
      pattern,
      source_type: sourceType,
    }
  }
}
