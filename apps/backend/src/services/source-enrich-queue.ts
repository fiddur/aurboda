/**
 * Source enrichment queue (#1080).
 *
 * When a Health Connect batch delivers a session that belongs to a provider
 * we sync directly, the upload route enqueues one job per session here. The
 * worker fetches that provider's own detail right away instead of waiting for
 * the next poll: Gravl's sets for a strength session, Garmin's summary and
 * per-second detail for an activity, Garmin's sleep record for a night.
 *
 * Jobs start after a short delay (the phone uploads in chunks, and the source
 * may still be finishing its own upload) and are singletons per target, so a
 * burst of re-sent HC records collapses into one fetch. Failures throw so
 * pg-boss retries with backoff — a Gravl 404 a minute after the app wrote the
 * HC record usually means the workout is still being saved.
 */
import type { GravlProcessOutcome } from '../integrations/gravl/process.ts'
import type { PgBoss } from './pg-boss.ts'
import type { SourceArrival, SourceKind, SourceProvider } from './source-identity.ts'

import { auditError, auditInfo } from './audit-log.ts'

const QUEUE_NAME = 'source-enrich'

/** Seconds to wait before the first attempt. */
export const ENRICH_DELAY_SECONDS = 60
const RETRY_LIMIT = 3
const RETRY_DELAY_SECONDS = 120

export interface SourceEnrichJobData {
  user: string
  provider: SourceProvider
  kind: SourceKind
  key: string
}

export interface SourceEnrichDeps {
  /** Fetch one Gravl workout and store it; null when the Gravl integration is off. */
  enrichGravl: ((user: string, workoutId: string) => Promise<GravlProcessOutcome>) | null
  isGravlConnected: (user: string) => Promise<boolean>
  /** Run an incremental Garmin sync for one data type (activities also fetches detail); null when Garmin is off. */
  syncGarmin: ((user: string, dataType: 'activities' | 'sleep') => Promise<void>) | null
  isGarminConnected: (user: string) => Promise<boolean>
  /** Fired after a successful enrichment so deduction / auto-share rules see the new data. */
  onEnriched?: (user: string) => void
}

export interface SourceEnrichQueue {
  enqueue: (user: string, arrivals: SourceArrival[]) => Promise<void>
}

/**
 * One job per HC session, but Garmin's `activities` sync fetches the latest
 * activities regardless of id, so every Garmin job of a kind shares one
 * singleton per user — ten sessions in one batch cost one sync. Gravl fetches
 * by workout id, so its singleton is per workout.
 */
export const enrichSingletonKey = (job: SourceEnrichJobData): string =>
  job.provider === 'garmin'
    ? `${job.user}:garmin:${job.kind}`
    : `${job.user}:${job.provider}:${job.kind}:${job.key}`

export type EnrichOutcome = 'enriched' | 'skipped'

/**
 * Dispatch one job. Returns 'skipped' when the user has no connection for the
 * provider (nothing to enrich with); throws on provider failure so the queue
 * retries.
 */
export const runSourceEnrichment = async (
  job: SourceEnrichJobData,
  deps: SourceEnrichDeps,
): Promise<EnrichOutcome> => {
  if (job.provider === 'gravl') {
    if (!deps.enrichGravl || !(await deps.isGravlConnected(job.user))) return 'skipped'
    const outcome = await deps.enrichGravl(job.user, job.key)
    if (outcome === 'skipped') return 'skipped'
    auditInfo(job.user, 'sync', `Gravl workout ${outcome} from Health Connect arrival`, {
      workout_id: job.key,
    })
    deps.onEnriched?.(job.user)
    return 'enriched'
  }

  if (!deps.syncGarmin || !(await deps.isGarminConnected(job.user))) return 'skipped'
  await deps.syncGarmin(job.user, job.kind === 'sleep' ? 'sleep' : 'activities')
  auditInfo(job.user, 'sync', `Garmin ${job.kind} synced from Health Connect arrival`, { key: job.key })
  deps.onEnriched?.(job.user)
  return 'enriched'
}

/* v8 ignore start -- requires real pg-boss instance */
export const createSourceEnrichQueue = async (
  boss: PgBoss,
  deps: SourceEnrichDeps,
): Promise<SourceEnrichQueue> => {
  await boss.createQueue(QUEUE_NAME)

  // One job per batch: pg-boss completes or fails a batch as a unit, so a
  // throwing job (a Gravl 404 while the workout is still saving) would otherwise
  // re-queue its batch-mates too. A failure propagates so pg-boss retries it.
  await boss.work<SourceEnrichJobData>(
    QUEUE_NAME,
    { batchSize: 1, pollingIntervalSeconds: 10 },
    async ([job]) => {
      if (!job) return
      const outcome = await runSourceEnrichment(job.data, deps)
      if (outcome === 'enriched') {
        console.info(`🔗 enriched ${job.data.provider} ${job.data.kind} for ${job.data.user}`)
      }
    },
  )

  console.info('🔗 Source enrichment queue ready')

  return {
    enqueue: async (user, arrivals) => {
      for (const arrival of arrivals) {
        const data: SourceEnrichJobData = {
          key: arrival.key,
          kind: arrival.kind,
          provider: arrival.provider,
          user,
        }
        try {
          await boss.send(QUEUE_NAME, data, {
            retryBackoff: true,
            retryDelay: RETRY_DELAY_SECONDS,
            retryLimit: RETRY_LIMIT,
            singletonKey: enrichSingletonKey(data),
            startAfter: ENRICH_DELAY_SECONDS,
          })
        } catch (err) {
          auditError(user, 'sync', 'Failed to enqueue source enrichment', { arrival, error: String(err) })
        }
      }
    },
  }
}
/* v8 ignore stop */
