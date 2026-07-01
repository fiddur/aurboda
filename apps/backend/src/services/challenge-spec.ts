import type { ChallengeEffectiveBucketSize, ChallengeSpec, ChartDataBucket } from '@aurboda/api-spec'

/**
 * Translate a stored challenge spec into a chart-data query and compute a
 * member's series + cumulative total. Reuses the same `getChartData` engine the
 * dashboards use, so a challenge metric is just a summed/counted bucketed series.
 */
import type { ChallengeSpecFields } from '../db/index.ts'

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
  const { buckets } = await getChartData(user, {
    activity_type_id: spec.activity_type_id ?? undefined,
    aggregation: spec.aggregation,
    bucket_size: effectiveBucketSize(spec.bucket_size, start, end),
    end: end.toISOString(),
    pattern: spec.pattern ?? undefined,
    source_type: spec.source_type,
    start: start.toISOString(),
  })

  // We never request breakdown series, so every bucket has a scalar `value`.
  const plain = buckets.flatMap((b) =>
    'value' in b ? [{ bucket_start: b.bucket_start, value: b.value }] : [],
  )
  const total = plain.reduce((sum, b) => sum + b.value, 0)
  return { buckets: plain, total }
}
