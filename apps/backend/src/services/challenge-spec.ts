import type { ChallengeEffectiveBucketSize, ChallengeSpec, ChartDataBucket } from '@aurboda/api-spec'

/**
 * Translate a stored challenge spec into a chart-data query and compute a
 * member's series + cumulative total. Reuses the same `getChartData` engine the
 * dashboards use, so a challenge metric is just a summed/counted bucketed series.
 */
import type { ChallengeSpecFields } from '../db/index.ts'

import { expandActivityTypes, getSourceFilter, query } from '../db/index.ts'
import { getChartData } from './chart-data.ts'

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
})

export interface MemberSeries {
  buckets: ChartDataBucket[]
  total: number
  /**
   * Timestamp of the member's most recent contributing data point in the
   * window (ISO 8601), or null if they have no data. This is the honest "last
   * updated" for standings — a member with no data reports null, not "now".
   */
  last_updated: string | null
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
 *    activities.
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
 * whose data is being measured (the member, on this instance).
 */
export const resolveMemberSeries = async (
  user: string,
  spec: ChallengeSpecFields,
  start: Date,
  end: Date,
): Promise<MemberSeries> => {
  const [{ buckets }, lastDataTime] = await Promise.all([
    getChartData(user, {
      activity_type_id: spec.activity_type_id ?? undefined,
      aggregation: spec.aggregation,
      bucket_size: effectiveBucketSize(spec.bucket_size, start, end),
      end: end.toISOString(),
      pattern: spec.pattern ?? undefined,
      source_type: spec.source_type,
      start: start.toISOString(),
    }),
    resolveLastDataTime(user, spec, start, end),
  ])

  // We never request breakdown series, so every bucket has a scalar `value`.
  const plain = buckets.flatMap((b) =>
    'value' in b ? [{ bucket_start: b.bucket_start, value: b.value }] : [],
  )
  const total = plain.reduce((sum, b) => sum + b.value, 0)
  return { buckets: plain, last_updated: lastDataTime?.toISOString() ?? null, total }
}
