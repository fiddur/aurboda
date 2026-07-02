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
import { type FeedVisibility, hrZoneMetrics } from '@aurboda/api-spec'

import type { MetricType } from '../../schema.ts'
import type { QueryMetricsBucketedResult } from '../queries/types.ts'
import type { AS2Create, ScalarMetric } from './object.ts'
import type { MetricStat, ScalarStat } from './scalars.ts'

import { getTimeSeries } from '../../db/index.ts'
import { queryMetricsBucketed } from '../queries/index.ts'
import { computeHrZoneSecs, getEffectiveHrZones } from '../settings.ts'
import { buildCreateExercise } from './object.ts'
import { resolveSharedScalars, SCALAR_SOURCE_METRICS } from './scalars.ts'

/** Maps `hr_zone_<n>_sec` → the numeric zone index (0–5) in `HrZoneSecs`. */
const HR_ZONE_INDEX = new Map<string, 0 | 1 | 2 | 3 | 4 | 5>(
  hrZoneMetrics.map((m, i) => [m, i as 0 | 1 | 2 | 3 | 4 | 5]),
)

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
 * add, max takes the extreme, and avg is re-weighted by sample count.
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

/**
 * Resolve the shared scalar values for an activity against the database: fetch
 * the source metrics aggregated over the activity window (one bucketed query),
 * then map the user's `includedMetrics` selection into `ScalarMetric[]`. The
 * window is `[start, end]`; an activity with no end has no window, so only
 * window-independent keys (none, currently) resolve.
 */
export const resolveActivityScalars = async (
  user: string,
  activity: { start_time: Date; end_time?: Date },
  includedMetrics: string[],
): Promise<ScalarMetric[]> => {
  const start = activity.start_time
  const end = activity.end_time ?? activity.start_time
  // One bucket sized to the window; windowMetricStat re-merges if PG splits it.
  const seconds = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1000))
  const result = await queryMetricsBucketed(user, SCALAR_SOURCE_METRICS, start, end, `${seconds}s`, {})
  const base = windowMetricStat(result)

  // HR-zone seconds aren't stored in time_series — derive them from heart_rate
  // over the window using the user's effective zones, but only when requested.
  let zoneSecs: Record<number, number> | undefined
  if (includedMetrics.includes('hr_zone_minutes') && activity.end_time) {
    const [{ zones }, hrData] = await Promise.all([
      getEffectiveHrZones(user),
      getTimeSeries(user, 'heart_rate', start, end),
    ])
    zoneSecs = computeHrZoneSecs(hrData, zones)
  }

  const metricStat: MetricStat = (metric, stat) => {
    const zoneIndex = HR_ZONE_INDEX.get(metric)
    if (zoneSecs !== undefined && zoneIndex !== undefined) return zoneSecs[zoneIndex]
    return base(metric, stat)
  }

  return resolveSharedScalars({ endTime: activity.end_time, startTime: start }, includedMetrics, metricStat)
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
