import type {
  ActivityMeasure,
  ChallengeAggregation,
  ChallengeDataResponse,
  ChallengeEffectiveBucketSize,
  ChallengeSpec,
  ChartDataBucket,
} from '@aurboda/api-spec'

import { isKnownTimezone } from '@aurboda/api-spec'

/**
 * Translate a stored challenge spec into a chart-data query and compute a
 * member's series + score. Reuses the same `getChartData` engine the dashboards
 * use, so a challenge is a bucketed series scored by its sum, count or best bucket.
 */
import type { ChallengeSpecFields } from '../db/index.ts'

import { expandActivityTypes, getSourceFilter, query } from '../db/index.ts'
import { normalizeItemValue } from './activity-measures.ts'
import { getChartData } from './chart-data.ts'
import { measureFilter, queryMeasuredActivities } from './queries/activity-measure-series.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Resolve the concrete chart bucket size the race chart is rendered with. `auto`
 * adapts to the window — fine buckets so a short challenge shows intraday progress,
 * coarse buckets so a long one stays readable and keeps payloads/caches small — while
 * a fixed choice (a creator override for very long challenges) is used as-is. Derived
 * purely from the window, so every instance resolves the same size for a given
 * challenge without extra coordination. Bucket size never affects the cumulative
 * total (scoring), only chart granularity.
 */
export const effectiveBucketSize = (
  chosen: ChallengeSpecFields['bucket_size'],
  start: Date,
  end: Date,
): ChallengeEffectiveBucketSize => {
  if (chosen !== 'auto') return chosen
  const days = (end.getTime() - start.getTime()) / DAY_MS
  if (days <= 1) return '5m'
  if (days <= 3) return '15m'
  if (days <= 14) return '1h'
  if (days <= 120) return '1d'
  return '1w'
}

/** Convert a stored spec (nullable optionals) to the api-spec shape (omitted optionals). */
export const specToApi = (spec: ChallengeSpecFields): ChallengeSpec => ({
  aggregation: spec.aggregation,
  bucket_size: spec.bucket_size,
  pattern: spec.pattern,
  source_type: spec.source_type,
  unit: spec.unit,
  ...(spec.activity_type_id !== null ? { activity_type_id: spec.activity_type_id } : {}),
  ...(spec.measure !== null ? { measure: spec.measure } : {}),
  ...(spec.filter_field !== null ? { filter_field: spec.filter_field } : {}),
  ...(spec.filter_value !== null ? { filter_value: spec.filter_value } : {}),
})

/** Convert an api-spec spec (omitted optionals) to the stored shape (nullable optionals). */
export const toSpecFields = (spec: ChallengeSpec): ChallengeSpecFields => ({
  activity_type_id: spec.activity_type_id ?? null,
  aggregation: spec.aggregation,
  bucket_size: spec.bucket_size,
  filter_field: spec.filter_field ?? null,
  filter_value: spec.filter_value ?? null,
  measure: spec.measure ?? null,
  pattern: spec.pattern,
  source_type: spec.source_type,
  unit: spec.unit,
})

/** A member's score from their buckets: the best bucket for `max` (0 with none), else their sum. */
export const scoreBuckets = (buckets: { value: number }[], aggregation: ChallengeAggregation): number =>
  aggregation === 'max'
    ? buckets.reduce((best, b) => Math.max(best, b.value), 0)
    : buckets.reduce((sum, b) => sum + b.value, 0)

/**
 * Whether a member's data response was scored the way a measure challenge asks: the same measure,
 * aggregation and item filter. An instance too old to know the measure omits it (and would report
 * plain duration), so it does not match. A spec without a measure matches any response.
 */
export const memberEchoMatches = (spec: ChallengeSpecFields, data: ChallengeDataResponse): boolean =>
  spec.measure === null ||
  (data.measure === spec.measure &&
    data.aggregation === spec.aggregation &&
    (data.filter_field ?? null) === spec.filter_field &&
    normalizeItemValue(data.filter_value) === normalizeItemValue(spec.filter_value))

export const unsupportedMeasureMessage = (measure: string): string =>
  `Your instance does not support this challenge's measure (${measure}); update Aurboda to join`

export const echoMismatchMessage = (spec: ChallengeSpecFields, data: ChallengeDataResponse): string =>
  data.measure === spec.measure
    ? 'Your instance scored this challenge differently (aggregation/filter); update Aurboda and rejoin'
    : unsupportedMeasureMessage(spec.measure ?? '')

export interface MemberSeries {
  buckets: ChartDataBucket[]
  total: number
  /**
   * When the member's contributing data last changed (ISO 8601): the newest
   * value-change stamp among the points in the window (falling back to a
   * point's own time for rows stored before that was tracked), or the latest
   * matching activity start; null if they have no data. This is the honest
   * "last updated" for standings — a member with no data reports null, not "now".
   */
  last_updated: string | null
}

/** The start of the latest session in the window that has the measure (over the filtered items). */
const latestMeasuredStart = async (
  user: string,
  spec: ChallengeSpecFields,
  measure: ActivityMeasure,
  start: Date,
  end: Date,
): Promise<Date | null> => {
  const measured = await queryMeasuredActivities(
    user,
    spec.pattern,
    start,
    end,
    measureFilter(spec.filter_field ?? undefined, spec.filter_value ?? undefined),
  )
  return measured.findLast((m) => m.measures[measure] !== undefined)?.activity.start_time ?? null
}

/**
 * When a member's contributing data for a challenge spec last changed.
 *
 * Mirrors the filters `getChartData` uses to build the total so the timestamp
 * belongs to a record that actually counts:
 *  - `metric`: the newest of each contributing point's `updated_at` (when its
 *    value last changed) or, for rows from before that column existed, its
 *    `time`. Daily aggregates such as steps keep one row per day at local
 *    midnight and are rewritten all day, so `time` alone would always read
 *    "00:00" no matter how often the total moved. Respects the metric's trusted
 *    source filter; HR-zone metrics are computed from heart-rate samples, so
 *    we read the underlying `heart_rate` series instead.
 *  - `activity_type`: MAX(start_time) of the matching (non-deleted, current)
 *    activities; with a measure, the latest session that has measured items
 *    (under the item filter), so a session without the filtered exercise is
 *    not data.
 * Returns null when there is no matching data (e.g. a member on 0).
 */
const resolveLastDataTime = async (
  user: string,
  spec: ChallengeSpecFields,
  start: Date,
  end: Date,
): Promise<Date | null> => {
  if (spec.source_type === 'metric') {
    // Same routing as chart-data's queryMetricSource: zone2_weekly is an alias
    // for zone-2 seconds, and any hr_zone_* metric is derived from heart_rate.
    const pattern = spec.pattern === 'zone2_weekly' ? 'hr_zone_2_sec' : spec.pattern
    const metric = /^hr_zone_[0-5]_sec$/.test(pattern) ? 'heart_rate' : pattern
    const sourceFilter = getSourceFilter(metric)
    const params: unknown[] = [metric, start.toISOString(), end.toISOString()]
    let sourceClause = ''
    if (sourceFilter !== null) {
      params.push(sourceFilter)
      sourceClause = ` AND source = ANY($${params.length})`
    }
    const result = await query<{ latest: Date | null }>(
      user,
      `SELECT MAX(COALESCE(updated_at, time)) AS latest
         FROM time_series
        WHERE metric = $1
          AND time BETWEEN $2 AND $3
          AND deleted_at IS NULL${sourceClause}`,
      params,
    )
    return result.rows[0]?.latest ?? null
  }

  if (spec.source_type === 'activity_type' && spec.measure !== null) {
    return latestMeasuredStart(user, spec, spec.measure, start, end)
  }

  if (spec.source_type === 'activity_type') {
    const types = await expandActivityTypes(user, [spec.pattern])
    const result = await query<{ latest: Date | null }>(
      user,
      `SELECT MAX(start_time) AS latest
         FROM activities
        WHERE activity_type = ANY($1)
          AND deleted_at IS NULL
          AND superseded_by IS NULL
          AND start_time BETWEEN $2 AND $3`,
      [types, start.toISOString(), end.toISOString()],
    )
    return result.rows[0]?.latest ?? null
  }

  return null
}

/**
 * Resolve a member's series for a challenge window. `user` is the *local* user
 * whose data is being measured (the member, on this instance). Buckets follow
 * the challenge's `timezone` (UTC when unknown), not the member's, so every
 * member's days line up.
 */
export const resolveMemberSeries = async (
  user: string,
  spec: ChallengeSpecFields,
  start: Date,
  end: Date,
  timezone: string,
): Promise<MemberSeries> => {
  // `end` is exclusive but the queries below use an inclusive BETWEEN, and daily aggregates
  // sit at local midnight — exactly at `end` — so without this step back the day after the
  // challenge would count.
  const lastInstant = new Date(end.getTime() - 1)
  const [{ buckets }, lastDataTime] = await Promise.all([
    getChartData(user, {
      activity_type_id: spec.activity_type_id ?? undefined,
      aggregation: spec.aggregation,
      bucket_size: effectiveBucketSize(spec.bucket_size, start, end),
      end: lastInstant.toISOString(),
      filter_field: spec.filter_field ?? undefined,
      filter_value: spec.filter_value ?? undefined,
      measure: spec.measure ?? undefined,
      pattern: spec.pattern ?? undefined,
      source_type: spec.source_type,
      start: start.toISOString(),
      tz: isKnownTimezone(timezone) ? timezone : 'UTC',
    }),
    resolveLastDataTime(user, spec, start, lastInstant),
  ])

  // We never request breakdown series, so every bucket has a scalar `value`.
  const plain = buckets.flatMap((b) =>
    'value' in b ? [{ bucket_start: b.bucket_start, value: b.value }] : [],
  )
  const total = scoreBuckets(plain, spec.aggregation)
  return { buckets: plain, last_updated: lastDataTime?.toISOString() ?? null, total }
}
