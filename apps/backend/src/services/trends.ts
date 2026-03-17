/**
 * Trends service for calculating time-weighted averages using Exponential Moving Average (EMA).
 *
 * EMA gives more weight to recent data while still smoothing over a configurable period.
 * The half-life parameter controls how quickly the weight decays - after half-life days,
 * an event's weight drops to 50%.
 */

import {
  displayPeriodMultipliers,
  isValidMetric,
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
  aggregation?: 'count' | 'mean' | 'sum'
  display_period?: TrendDisplayPeriod
  half_life_days?: number
  lookback_days?: number
  pattern: string
  source_type: TrendSourceType
}

/**
 * Calculate the EMA-weighted trend for tags matching a pattern.
 *
 * For each day, calculates the count of matching tags, then applies EMA weighting
 * to get a smoothed daily rate, which is then scaled to the display period.
 */
const calculateTagTrend = async (
  user: string,
  pattern: string,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = displayPeriodMultipliers[displayPeriod]

  // Query daily tag counts and calculate EMA for each day in the lookback period
  // This creates a time series of trend values, not just the current value
  const result = await query(
    user,
    `
    WITH date_range AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '1 day' * $2::integer,
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
        FROM tags
        WHERE tag ~* $1
          AND start_time > CURRENT_DATE - INTERVAL '1 day' * ($2::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dc.day,
        -- Calculate EMA as weighted average for this point in time
        $4::float * SUM(dc2.cnt::float * EXP(-$3::float * (dc.day - dc2.day)::float / $5::float)) /
        NULLIF(SUM(EXP(-$3::float * (dc.day - dc2.day)::float / $5::float)), 0) as ema_value
      FROM daily_counts dc
      CROSS JOIN LATERAL (
        SELECT day, cnt
        FROM daily_counts
        WHERE day <= dc.day AND day > dc.day - INTERVAL '1 day' * LEAST($2::integer, 90)
      ) dc2
      GROUP BY dc.day
    )
    SELECT day, COALESCE(ema_value, 0) as ema_value
    FROM ema_calc
    ORDER BY day
    `,
    [pattern, lookbackDays, LN2, multiplier, halfLifeDays],
  )

  const history: TrendHistoryPoint[] = result.rows.map((row) => ({
    date: row.day.toISOString().split('T')[0],
    value: Number(row.ema_value),
  }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
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

  const result = await query(
    user,
    `
    WITH date_range AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '1 day' * $2::integer,
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
          AND time > CURRENT_DATE - INTERVAL '1 day' * ($2::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dv.day,
        -- Calculate EMA as weighted average, excluding days with no data
        $4::float * SUM(dv2.daily_value * EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)) /
        NULLIF(SUM(CASE WHEN dv2.daily_value IS NOT NULL THEN EXP(-$3::float * (dv.day - dv2.day)::float / $5::float) ELSE 0 END), 0) as ema_value
      FROM daily_values dv
      CROSS JOIN LATERAL (
        SELECT day, daily_value
        FROM daily_values
        WHERE day <= dv.day AND day > dv.day - INTERVAL '1 day' * LEAST($2::integer, 90)
      ) dv2
      GROUP BY dv.day
    )
    SELECT day, ema_value
    FROM ema_calc
    ORDER BY day
    `,
    [metric, lookbackDays, LN2, multiplier, halfLifeDays],
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
 * Get the trend for a tag pattern or metric.
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

  const displayUnits: Record<TrendDisplayPeriod, string> = {
    daily: 'per day',
    monthly: 'per month',
    weekly: 'per week',
  }

  if (sourceType === 'tag') {
    const { currentValue, history } = await calculateTagTrend(
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
  } else {
    // Metric source
    if (!isValidMetric(pattern)) {
      throw new Error(`Invalid metric: ${pattern}`)
    }

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
