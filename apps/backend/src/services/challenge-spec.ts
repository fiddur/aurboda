import type { ChallengeSpec, ChartDataBucket } from '@aurboda/api-spec'

/**
 * Translate a stored challenge spec into a chart-data query and compute a
 * member's series + cumulative total. Reuses the same `getChartData` engine the
 * dashboards use, so a challenge metric is just a summed/counted bucketed series.
 */
import type { ChallengeSpecFields } from '../db/index.ts'

import { getChartData } from './chart-data.ts'

/** Convert a stored spec (nullable optionals) to the api-spec shape (omitted optionals). */
export const specToApi = (spec: ChallengeSpecFields): ChallengeSpec => ({
  aggregation: spec.aggregation,
  bucket_size: spec.bucket_size,
  source_type: spec.source_type,
  unit: spec.unit,
  ...(spec.activity_type_id !== null ? { activity_type_id: spec.activity_type_id } : {}),
  ...(spec.pattern !== null ? { pattern: spec.pattern } : {}),
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
    bucket_size: spec.bucket_size,
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
