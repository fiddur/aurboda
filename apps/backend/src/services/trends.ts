/**
 * EMA gives more weight to recent data while still smoothing over a configurable period.
 * The half-life parameter controls how quickly the weight decays - after half-life days,
 * an event's weight drops to 50%.
 */

import {
  type ActivityMeasure,
  activityMeasureUnits,
  type CustomMetricDefinition,
  displayPeriodMultipliers,
  getMetricAggregation,
  getMetricUnit,
  type MetricType,
  type TrendDisplayPeriod,
  type TrendHistoryPoint,
  type TrendMissingDays,
  type TrendResult,
  type TrendSourceType,
} from '@aurboda/api-spec'

import { getSourceFilter, query } from '../db/index.ts'
import { dayEndInTz, dayKey, dayKeysEndingAt, dayStartInTz } from './day-keys.ts'
import {
  type MeasureFilter,
  measureFilter,
  queryMeasuredActivities,
} from './queries/activity-measure-series.ts'
import { categoryPathMatchSql, subcategoryLikePattern } from './screentime-sql.ts'

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
  filter_field?: string
  filter_value?: string
  half_life_days?: number
  lookback_days?: number
  measure?: ActivityMeasure
  missing_days?: TrendMissingDays
  pattern: string
  source_type: TrendSourceType
  /** @deprecated Use activity_type_id instead */
  tag_definition_id?: string
  /** IANA timezone whose calendar days the trend is computed over; UTC when unset. */
  tz?: string
  /** The trend ends on the calendar day holding this instant; now when unset. */
  end?: Date
}

/** Today's date in the timezone bound to parameter `$n`. */
const todaySql = (n: number): string => `(now() AT TIME ZONE $${n}::text)::date`

/**
 * The SQL for the trend's last day: today in the timezone bound to `$tzParam`, or the anchor day appended
 * to `params` when there is one.
 */
const anchorDaySql = (params: unknown[], tzParam: number, anchorDay: string | undefined): string =>
  anchorDay === undefined ? todaySql(tzParam) : `$${params.push(anchorDay)}::date`

const metricDailyValueSql: Record<'count' | 'mean' | 'sum', string> = {
  count: 'COUNT(*)',
  mean: 'AVG(value)',
  sum: 'SUM(value)',
}

/**
 * The summed EMA weight of a display period's days. A zero-filled series divides by at least this, so until it is
 * one period old the days before its first sample are counted as zeros: a lone first session then reads as itself per
 * period, not as that day's amount scaled up to a period. Beyond the first period the floor has no effect.
 */
export const firstPeriodWeight = (halfLifeDays: number, periodDays: number): number =>
  Array.from({ length: Math.max(1, periodDays) }, (_, k) => Math.exp((-LN2 * k) / halfLifeDays)).reduce(
    (a, b) => a + b,
    0,
  )

/**
 * Days of warm-up before the lookback: three half-lives, and at least a display period less a day so the oldest
 * displayed point of a series older than the window weighs a full period and `firstPeriodWeight` only ever bites at a
 * series' real start.
 */
const warmupLength = (halfLifeDays: number, periodDays: number): number =>
  Math.max(3 * halfLifeDays, periodDays - 1)

/**
 * The `series_start` and `date_range` CTEs: the days from the warm-up start (`$6` days back) to today, but
 * none before the series' first sample, which `firstSampleSql` selects as `first_day`. A series without samples has no
 * days at all. Without `firstSampleSql`, every day of the window.
 */
const seriesDateRangeSql = (today: string, firstSampleSql: string | undefined): string =>
  firstSampleSql === undefined
    ? `
    date_range AS (
      SELECT generate_series(
        ${today} - INTERVAL '1 day' * $6::integer,
        ${today},
        '1 day'
      )::date AS day
    )`
    : `
    series_start AS (${firstSampleSql}),
    date_range AS (
      SELECT d::date AS day
      FROM generate_series(
        ${today} - INTERVAL '1 day' * $6::integer,
        ${today},
        '1 day'
      ) AS d, series_start
      WHERE d >= series_start.first_day
    )`

/**
 * With 'zero', a day without samples enters the EMA as 0 and keeps its weight in the denominator;
 * with 'skip', it is left out of both, so the EMA is the weighted mean over sampled days only.
 */
const calculateMetricTrend = async (
  user: string,
  metric: MetricType,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  aggregation: 'count' | 'mean' | 'sum',
  missingDays: TrendMissingDays,
  tz: string,
  anchorDay?: string,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = aggregation === 'mean' ? 1 : displayPeriodMultipliers[displayPeriod]
  const warmupDays = lookbackDays + warmupLength(halfLifeDays, multiplier)
  const sources = getSourceFilter(metric)
  const weight = 'EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)'
  const params: unknown[] = [
    metric,
    lookbackDays,
    LN2,
    multiplier,
    halfLifeDays,
    warmupDays,
    tz,
    ...(sources ? [sources] : []),
  ]
  const today = anchorDaySql(params, 7, anchorDay)
  const emaSql =
    missingDays === 'zero'
      ? `$4::float * SUM(COALESCE(dv2.daily_value, 0) * ${weight}) /
        GREATEST(SUM(${weight}), $${params.push(firstPeriodWeight(halfLifeDays, multiplier))}::float)`
      : `$4::float * SUM(dv2.daily_value * ${weight}) /
        NULLIF(SUM(CASE WHEN dv2.daily_value IS NOT NULL THEN ${weight} ELSE 0 END), 0)`
  const emaValueSql = missingDays === 'zero' ? 'COALESCE(ema_value, 0) AS ema_value' : 'ema_value'
  const sourceFilterSql = sources ? '\n          AND source = ANY($8)' : ''

  const result = await query(
    user,
    `
    WITH ${seriesDateRangeSql(
      today,
      missingDays === 'zero'
        ? `SELECT (MIN(time) AT TIME ZONE $7::text)::date AS first_day
        FROM time_series
        WHERE metric = $1
          AND deleted_at IS NULL${sourceFilterSql}`
        : undefined,
    )},
    daily_values AS (
      SELECT
        d.day,
        t.daily_value
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', time AT TIME ZONE $7::text)::date as day,
          ${metricDailyValueSql[aggregation]} as daily_value
        FROM time_series
        WHERE metric = $1
          AND time > ${today} - INTERVAL '1 day' * ($6::integer + 1)
          AND deleted_at IS NULL${sourceFilterSql}
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dv.day,
        ${emaSql} as ema_value
      FROM daily_values dv
      CROSS JOIN LATERAL (
        SELECT day, daily_value
        FROM daily_values
        WHERE day <= dv.day AND day > dv.day - INTERVAL '1 day' * 90
      ) dv2
      GROUP BY dv.day
    )
    SELECT day, ${emaValueSql}
    FROM ema_calc
    WHERE day >= ${today} - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    params,
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

const screentimeSpanFilterSql = `deleted_at IS NULL
            AND superseded_by IS NULL
            AND end_time IS NOT NULL`

/**
 * The first day of a category's spans (`$1`) and its sub-categories' (`subcategoryPattern`). A plain MIN over the
 * LIKE match is planned as a walk of the time index, which reads the whole table for a young or unknown category, and
 * forcing the path index instead reads every matching span. So this skips through the distinct sub-category paths in
 * `idx_activities_category_path_start` order and takes each path's earliest span from the same index.
 */
const categoryFirstSpanSql = (subcategoryPattern: string): string => `
      WITH RECURSIVE sub_paths AS (
        (SELECT data->>'category_path' AS path
           FROM activities
          WHERE ${screentimeSpanFilterSql}
            AND data->>'category_path' LIKE ${subcategoryPattern}
          ORDER BY data->>'category_path' USING ~<~
          LIMIT 1)
        UNION ALL
        SELECT (SELECT data->>'category_path'
                  FROM activities
                 WHERE ${screentimeSpanFilterSql}
                   AND data->>'category_path' LIKE ${subcategoryPattern}
                   AND data->>'category_path' ~>~ sub_paths.path
                 ORDER BY data->>'category_path' USING ~<~
                 LIMIT 1)
          FROM sub_paths
         WHERE sub_paths.path IS NOT NULL
      ),
      paths AS (
        SELECT $1::text AS path
        UNION ALL
        SELECT path FROM sub_paths WHERE path IS NOT NULL
      )
      SELECT (MIN((SELECT MIN(start_time)
                     FROM activities
                    WHERE ${screentimeSpanFilterSql}
                      AND data->>'category_path' = paths.path)) AT TIME ZONE $7::text)::date AS first_day
        FROM paths`

/**
 * Aggregates daily screentime span hours from `activities` whose category path
 * is the given path or one of its sub-categories, then applies EMA.
 * Pattern is the category path joined by ' > ', e.g. "Work > Programming".
 */
const calculateProductivityCategoryTrend = async (
  user: string,
  categoryPath: string,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  tz: string,
  anchorDay?: string,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = displayPeriodMultipliers[displayPeriod]
  const warmupDays = lookbackDays + warmupLength(halfLifeDays, multiplier)

  const params: unknown[] = [categoryPath, lookbackDays, LN2, multiplier, halfLifeDays, warmupDays, tz]
  const today = anchorDaySql(params, 7, anchorDay)
  const floor = `$${params.push(firstPeriodWeight(halfLifeDays, multiplier))}::float`
  const subcategoryPattern = `$${params.push(subcategoryLikePattern(categoryPath))}`

  const result = await query(
    user,
    `
    WITH ${seriesDateRangeSql(today, categoryFirstSpanSql(subcategoryPattern))},
    daily_values AS (
      SELECT
        d.day,
        t.daily_hours
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', start_time AT TIME ZONE $7::text)::date as day,
          SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 3600.0 as daily_hours
        FROM activities
        WHERE deleted_at IS NULL
          AND superseded_by IS NULL
          AND end_time IS NOT NULL
          AND ${categoryPathMatchSql(1)}
          AND start_time > ${today} - INTERVAL '1 day' * ($6::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dv.day,
        $4::float * SUM(COALESCE(dv2.daily_hours, 0) * EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)) /
        GREATEST(SUM(EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)), ${floor}) as ema_value
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
    WHERE day >= ${today} - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    params,
  )

  const history: TrendHistoryPoint[] = result.rows.map((row) => ({
    date: row.day.toISOString().split('T')[0],
    value: Number(row.ema_value),
  }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
}

const activityTypeFirstSampleSql = `SELECT (MIN(start_time) AT TIME ZONE $7::text)::date AS first_day
        FROM activities
        WHERE activity_type = $1
          AND deleted_at IS NULL
          AND superseded_by IS NULL`

/**
 * Sums duration in hours per day, then applies EMA weighting.
 * Pattern is the activity type name (e.g. "yoga", "running", "coffee").
 */
const calculateActivityTypeTrend = async (
  user: string,
  pattern: string,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  tz: string,
  anchorDay?: string,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = displayPeriodMultipliers[displayPeriod]
  const warmupDays = lookbackDays + warmupLength(halfLifeDays, multiplier)

  const params: unknown[] = [pattern, lookbackDays, LN2, multiplier, halfLifeDays, warmupDays, tz]
  const today = anchorDaySql(params, 7, anchorDay)
  const floor = `$${params.push(firstPeriodWeight(halfLifeDays, multiplier))}::float`

  const result = await query(
    user,
    `
    WITH ${seriesDateRangeSql(today, activityTypeFirstSampleSql)},
    daily_values AS (
      SELECT
        d.day,
        t.daily_hours
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', start_time AT TIME ZONE $7::text)::date as day,
          SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 3600.0 as daily_hours
        FROM activities
        WHERE activity_type = $1
          AND deleted_at IS NULL
          AND superseded_by IS NULL
          AND start_time > ${today} - INTERVAL '1 day' * ($6::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dv.day,
        $4::float * SUM(COALESCE(dv2.daily_hours, 0) * EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)) /
        GREATEST(SUM(EXP(-$3::float * (dv.day - dv2.day)::float / $5::float)), ${floor}) as ema_value
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
    WHERE day >= ${today} - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    params,
  )

  const history: TrendHistoryPoint[] = result.rows.map((row) => ({
    date: row.day.toISOString().split('T')[0],
    value: Number(row.ema_value),
  }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
}

/**
 * Counts occurrences per day instead of summing duration.
 */
const calculateActivityTypeCountTrend = async (
  user: string,
  pattern: string,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  tz: string,
  anchorDay?: string,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const multiplier = displayPeriodMultipliers[displayPeriod]
  const warmupDays = lookbackDays + warmupLength(halfLifeDays, multiplier)

  const params: unknown[] = [pattern, lookbackDays, LN2, multiplier, halfLifeDays, warmupDays, tz]
  const today = anchorDaySql(params, 7, anchorDay)
  const floor = `$${params.push(firstPeriodWeight(halfLifeDays, multiplier))}::float`

  const result = await query(
    user,
    `
    WITH ${seriesDateRangeSql(today, activityTypeFirstSampleSql)},
    daily_counts AS (
      SELECT
        d.day,
        COALESCE(t.cnt, 0) as cnt
      FROM date_range d
      LEFT JOIN (
        SELECT
          date_trunc('day', start_time AT TIME ZONE $7::text)::date as day,
          count(*) as cnt
        FROM activities
        WHERE activity_type = $1
          AND deleted_at IS NULL
          AND superseded_by IS NULL
          AND start_time > ${today} - INTERVAL '1 day' * ($6::integer + 1)
        GROUP BY 1
      ) t ON d.day = t.day
    ),
    ema_calc AS (
      SELECT
        dc.day,
        $4::float * SUM(dc2.cnt::float * EXP(-$3::float * (dc.day - dc2.day)::float / $5::float)) /
        GREATEST(SUM(EXP(-$3::float * (dc.day - dc2.day)::float / $5::float)), ${floor}) as ema_value
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
    WHERE day >= ${today} - INTERVAL '1 day' * $2::integer
    ORDER BY day
    `,
    params,
  )

  const history: TrendHistoryPoint[] = result.rows.map((row) => ({
    date: row.day.toISOString().split('T')[0],
    value: Number(row.ema_value),
  }))

  const currentValue = history.length > 0 ? history[history.length - 1].value : 0

  return { currentValue, history }
}

const DAY_MS = 86_400_000

/**
 * The zero-filled EMA over `days`, by the same formula as the SQL trends: for each day,
 * multiplier * sum(value_i * weight_i) / max(sum(weight_i), firstPeriodWeight), with
 * weight_i = exp(-LN2 * daysAgo / halfLife) over at most the 90 days ending that day. Days before `firstDay` are
 * not part of the series: they have no weight and no point. Only points from `displayStartIdx` on are returned.
 */
export const computeEma = (
  dailyValues: Map<string, number>,
  days: string[],
  halfLifeDays: number,
  multiplier: number,
  { displayStartIdx = 0, firstDay = days[0] }: { displayStartIdx?: number; firstDay?: string } = {},
): TrendHistoryPoint[] => {
  const firstIdx = days.findIndex((day) => day >= firstDay)
  if (firstIdx === -1) return []
  const floor = firstPeriodWeight(halfLifeDays, multiplier)
  const history: TrendHistoryPoint[] = []

  for (let i = firstIdx; i < days.length; i++) {
    let weightedSum = 0
    let weightSum = 0
    const currentDay = Date.parse(days[i])

    for (let j = i; j >= firstIdx && i - j < 90; j--) {
      const daysAgo = (currentDay - Date.parse(days[j])) / DAY_MS
      const weight = Math.exp((-LN2 * daysAgo) / halfLifeDays)
      weightedSum += (dailyValues.get(days[j]) ?? 0) * weight
      weightSum += weight
    }

    if (i >= displayStartIdx) {
      history.push({ date: days[i], value: (multiplier * weightedSum) / Math.max(weightSum, floor) })
    }
  }

  return history
}

const oneDecimal = (value: number): number => Math.round(value * 10) / 10

/**
 * The decaying best over `days`: each day's value is the higher of its best session and the previous day's value
 * decayed by its half-life, so a weak session never pulls it down. Days before the first session have no point, and
 * only points from `displayStartIdx` on are returned. The carry is unrounded; rounding happens only on output.
 */
export const decayingBestHistory = (
  sessions: { day: string; value: number }[],
  days: string[],
  halfLifeDays: number,
  displayStartIdx: number,
): TrendHistoryPoint[] => {
  const bestByDay = new Map<string, number>()
  for (const { day, value } of sessions) bestByDay.set(day, Math.max(bestByDay.get(day) ?? -Infinity, value))

  const history: TrendHistoryPoint[] = []
  let prev: { time: number; value: number } | undefined
  days.forEach((day, i) => {
    const time = Date.parse(day)
    const carried = prev ? prev.value * 2 ** (-(time - prev.time) / DAY_MS / halfLifeDays) : -Infinity
    const value = Math.max(bestByDay.get(day) ?? -Infinity, carried)
    if (value === -Infinity) return
    prev = { time, value }
    if (i >= displayStartIdx) history.push({ date: day, value: oneDecimal(value) })
  })
  return history
}

/**
 * The decaying best of the points strictly before `day`, decayed to `day` (day keys): the value
 * `decayingBestHistory` would hold on `day` before that day's own sessions. Undefined without earlier points.
 * Unrounded.
 */
export const decayedBestAt = (
  points: { day: string; value: number }[],
  day: string,
  halfLifeDays: number,
): number | undefined => {
  const decay = (value: number, from: string, to: string) =>
    value * 2 ** (-(Date.parse(to) - Date.parse(from)) / DAY_MS / halfLifeDays)
  const earlier = points.filter((p) => p.day < day).toSorted((a, b) => a.day.localeCompare(b.day))
  const last = earlier.reduce<{ day: string; value: number } | undefined>(
    (prev, p) => ({
      day: p.day,
      value: Math.max(p.value, prev ? decay(prev.value, prev.day, p.day) : -Infinity),
    }),
    undefined,
  )
  return last && decay(last.value, last.day, day)
}

/**
 * The decaying best of a list-item measure over an activity type's sessions, warmed up over three half-lives before
 * the lookback so a best set then still carries into it.
 */
const calculateMeasureBestTrend = async (
  user: string,
  pattern: string,
  measure: ActivityMeasure,
  filter: MeasureFilter | undefined,
  halfLifeDays: number,
  lookbackDays: number,
  tz: string,
  anchorDay?: string,
): Promise<{ currentValue: number; history: TrendHistoryPoint[] }> => {
  const lookback = Math.ceil(lookbackDays)
  const now = new Date()
  const days = dayKeysEndingAt(
    anchorDay === undefined ? now : dayStartInTz(anchorDay, tz),
    lookback + Math.ceil(3 * halfLifeDays) + 1,
    tz,
  )
  const until = anchorDay === undefined ? now : dayEndInTz(anchorDay, tz)
  const activities = await queryMeasuredActivities(user, pattern, dayStartInTz(days[0], tz), until, filter)
  const sessions = activities.flatMap(({ activity, measures }) => {
    const value = measures[measure]
    return value === undefined ? [] : [{ day: dayKey(activity.start_time, tz), value }]
  })
  const history = decayingBestHistory(sessions, days, halfLifeDays, days.length - 1 - lookback)
  return { currentValue: history.at(-1)?.value ?? 0, history }
}

/**
 * Groups daily values by breakdown field, then computes EMA independently per series. The series share one x-axis
 * from the activity type's first sample: a series' days after that are real zeros, not days before it existed.
 */
const calculateActivityTypeBreakdownTrend = async (
  user: string,
  pattern: string,
  breakdownFields: string[],
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  aggregation: 'count' | 'sum',
  tz: string,
  anchorDay?: string,
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

  const warmupCount = warmupLength(halfLifeDays, multiplier)
  const warmupDays = lookbackDays + warmupCount
  const params: unknown[] = [pattern, warmupDays, tz]
  const today = anchorDaySql(params, 3, anchorDay)
  const result = await query(
    user,
    `SELECT date_trunc('day', start_time AT TIME ZONE $3::text)::date AS day,
            ${fieldSelects.join(', ')},
            ${valueExpr} AS value,
            (SELECT (MIN(start_time) AT TIME ZONE $3::text)::date::text
               FROM activities
              WHERE activity_type = $1
                AND deleted_at IS NULL
                AND superseded_by IS NULL) AS first_day
       FROM activities
      WHERE activity_type = $1
        AND deleted_at IS NULL
        AND superseded_by IS NULL
        AND start_time > ${today} - INTERVAL '1 day' * ($2::integer + 1)
      GROUP BY 1, ${fieldGroupBys.join(', ')}
      ORDER BY 1`,
    params,
  )

  const seriesDaily = new Map<string, Map<string, number>>()
  for (const row of result.rows) {
    const keyParts = breakdownFields.map((_, i) => row[`field_${i}`] as string)
    const seriesKey = keyParts.join(' / ')
    const day = (row.day as Date).toISOString().split('T')[0]
    const value = Number(row.value)

    seriesDaily.getOrInsertComputed(seriesKey, () => new Map()).set(day, value)
  }

  const days = dayKeysEndingAt(
    anchorDay === undefined ? new Date() : dayStartInTz(anchorDay, tz),
    warmupDays + 1,
    tz,
  )

  const firstDay: string | undefined = result.rows[0]?.first_day
  const series = [...seriesDaily.keys()].sort()
  const histories: Record<string, TrendHistoryPoint[]> = {}
  for (const s of series) {
    histories[s] = computeEma(seriesDaily.get(s)!, days, halfLifeDays, multiplier, {
      displayStartIdx: warmupCount,
      firstDay,
    })
  }

  return { histories, series }
}

const anchorDayOf = (end: Date | undefined, tz: string): string | undefined =>
  end === undefined ? undefined : dayKey(end, tz)

const displayUnits: Record<TrendDisplayPeriod, string> = {
  daily: 'per day',
  monthly: 'per month',
  weekly: 'per week',
}

const getActivityTypeTrend = async (
  user: string,
  input: GetTrendInput & { aggregation: 'count' | 'mean' | 'sum' },
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  tz: string,
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
      tz,
      anchorDayOf(input.end, tz),
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
      ? await calculateActivityTypeCountTrend(
          user,
          input.pattern,
          halfLifeDays,
          lookbackDays,
          displayPeriod,
          tz,
          anchorDayOf(input.end, tz),
        )
      : await calculateActivityTypeTrend(
          user,
          input.pattern,
          halfLifeDays,
          lookbackDays,
          displayPeriod,
          tz,
          anchorDayOf(input.end, tz),
        )

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

const metricDisplayUnit = (
  aggregation: 'count' | 'mean' | 'sum',
  unit: string | undefined,
  displayPeriod: TrendDisplayPeriod,
): string => {
  if (aggregation === 'mean') return unit ?? ''
  if (aggregation === 'sum' && unit) return `${unit} ${displayUnits[displayPeriod]}`
  return displayUnits[displayPeriod]
}

const getMetricTrend = async (
  user: string,
  input: GetTrendInput,
  halfLifeDays: number,
  lookbackDays: number,
  displayPeriod: TrendDisplayPeriod,
  tz: string,
): Promise<TrendResult> => {
  const { pattern, source_type: sourceType } = input
  const customMetrics = input.custom_metrics ?? []
  const metricAggregation = input.aggregation ?? 'mean'
  const missingDays: TrendMissingDays =
    metricAggregation === 'count'
      ? 'zero'
      : (input.missing_days ?? (getMetricAggregation(pattern, customMetrics) === 'sum' ? 'zero' : 'skip'))

  const { currentValue, history } = await calculateMetricTrend(
    user,
    pattern as MetricType,
    halfLifeDays,
    lookbackDays,
    displayPeriod,
    metricAggregation,
    missingDays,
    tz,
    anchorDayOf(input.end, tz),
  )

  return {
    aggregation: metricAggregation,
    current_value: currentValue,
    display_period: displayPeriod,
    display_unit: metricDisplayUnit(metricAggregation, getMetricUnit(pattern, customMetrics), displayPeriod),
    half_life_days: halfLifeDays,
    history,
    lookback_days: lookbackDays,
    missing_days: missingDays,
    pattern,
    source_type: sourceType,
  }
}

export const getTrend = async (user: string, input: GetTrendInput): Promise<TrendResult> => {
  const {
    aggregation = 'count',
    display_period: displayPeriod = 'monthly',
    half_life_days: halfLifeDays = 15,
    lookback_days: lookbackDays = 90,
    pattern,
    source_type: sourceType,
    tz = 'UTC',
  } = input
  const anchorDay = anchorDayOf(input.end, tz)

  if (sourceType === 'activity_type' && input.measure) {
    const { filter_field: filterField, filter_value: filterValue, measure } = input
    const { currentValue, history } = await calculateMeasureBestTrend(
      user,
      pattern,
      measure,
      measureFilter(filterField, filterValue),
      halfLifeDays,
      lookbackDays,
      tz,
      anchorDay,
    )

    return {
      aggregation: 'max',
      current_value: currentValue,
      display_period: displayPeriod,
      display_unit: activityMeasureUnits[measure],
      filter_field: filterField,
      filter_value: filterValue,
      half_life_days: halfLifeDays,
      history,
      lookback_days: lookbackDays,
      measure,
      pattern,
      source_type: sourceType,
    }
  }

  if (sourceType === 'tag') {
    // 'tag' is a backward-compat alias for activity_type count trend
    const { currentValue, history } = await calculateActivityTypeCountTrend(
      user,
      pattern,
      halfLifeDays,
      lookbackDays,
      displayPeriod,
      tz,
      anchorDay,
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
    return getActivityTypeTrend(
      user,
      { ...input, aggregation },
      halfLifeDays,
      lookbackDays,
      displayPeriod,
      tz,
    )
  } else if (sourceType === 'productivity_category') {
    const { currentValue, history } = await calculateProductivityCategoryTrend(
      user,
      pattern,
      halfLifeDays,
      lookbackDays,
      displayPeriod,
      tz,
      anchorDay,
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
    return getMetricTrend(user, input, halfLifeDays, lookbackDays, displayPeriod, tz)
  }
}
