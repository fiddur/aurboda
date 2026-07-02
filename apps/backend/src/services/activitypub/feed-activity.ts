/**
 * Assemble the AS2 `Create{Exercise}` for a stored feed post.
 *
 * Bridges the persistence layer (`feed_posts` + `activities`) to the pure AS2
 * serializer: resolves the shared scalar values over the activity window and
 * builds the canonical federation URLs, then hands off to `buildCreateExercise`.
 *
 * The metric aggregation is dependency-injected (`MetricStat`) so this is
 * unit-testable without a database; `windowMetricStat` adapts a
 * `queryMetricsBucketed` result into that shape for the delivery path.
 */
import type { FeedVisibility } from '@aurboda/api-spec'

import type { MetricType } from '../../schema.ts'
import type { QueryMetricsBucketedResult } from '../queries/types.ts'
import type { AS2Create } from './object.ts'
import type { MetricStat, ScalarStat } from './scalars.ts'

import { buildCreateExercise } from './object.ts'
import { resolveSharedScalars } from './scalars.ts'

/** Canonical federation URLs for a user, derived from the deploy's public hosts. */
export interface FeedActivityContext {
  username: string
  /** Canonical web origin, e.g. `https://aurboda.net` (actor, post id, aurboda: ns). */
  origin: string
  /** Public API base, e.g. `https://aurboda.net/api` (the public series endpoint). */
  apiBaseUrl: string
}

export interface FeedActivityInput {
  postId: string
  includedMetrics: string[]
  seriesMetrics: string[]
  visibility: FeedVisibility
  activityType: string
  startTime: Date
  endTime?: Date
  title?: string
  /** When the post was created (drives AS2 `published`). */
  publishedAt: Date
}

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

/**
 * Merge a bucketed-metrics result into a `MetricStat` over the whole window.
 * Buckets are combined so date-bin splitting never skews the aggregate: sums
 * add, max/min take the extreme, and avg is re-weighted by sample count.
 */
export const windowMetricStat = (result: QueryMetricsBucketedResult): MetricStat => {
  const merged = new Map<string, { sum: number; max: number; count: number; weighted: number }>()
  for (const bucket of result.buckets) {
    for (const [metric, stats] of Object.entries(bucket.metrics)) {
      if (!stats) continue
      const m = merged.get(metric) ?? { count: 0, max: -Infinity, sum: 0, weighted: 0 }
      m.sum += stats.sum ?? 0
      m.max = Math.max(m.max, stats.max)
      m.count += stats.count
      m.weighted += stats.avg * stats.count
      merged.set(metric, m)
    }
  }
  return (metric: MetricType, stat: ScalarStat): number | undefined => {
    const m = merged.get(metric)
    if (m === undefined) return undefined
    if (stat === 'sum') return m.sum
    if (stat === 'max') return m.max
    return m.count > 0 ? m.weighted / m.count : undefined
  }
}

/** Build the `Create{Exercise}` activity for a feed post. */
export const buildFeedPostActivity = (
  ctx: FeedActivityContext,
  input: FeedActivityInput,
  metricStat: MetricStat,
): AS2Create => {
  const origin = trimSlashes(ctx.origin)
  const actorUrl = `${origin}/users/${ctx.username}`
  const scalars = resolveSharedScalars(
    { endTime: input.endTime, startTime: input.startTime },
    input.includedMetrics,
    metricStat,
  )
  return buildCreateExercise({
    activityType: input.activityType,
    actorUrl,
    aurbodaNs: `${origin}/ns/activitystreams#`,
    endTime: input.endTime?.toISOString(),
    postId: `${actorUrl}/feed/${input.postId}`,
    publishedAt: input.publishedAt.toISOString(),
    scalars,
    seriesEndpointBase: `${trimSlashes(ctx.apiBaseUrl)}/public/${ctx.username}/series`,
    seriesMetrics: input.seriesMetrics,
    startTime: input.startTime.toISOString(),
    title: input.title,
    visibility: input.visibility,
  })
}
