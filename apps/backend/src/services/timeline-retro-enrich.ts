/**
 * Lazy retro-enrichment of home-timeline entries (#996).
 *
 * Structured enrichment normally happens on ingest, so entries received before
 * enrichment shipped — or whose ingest-time enrichment failed transiently —
 * keep `structured = NULL` forever and render as flat HTML/PNG. When the
 * timeline is read, this gives a small batch of such Aurboda-shaped entries one
 * more attempt (newest first), fire-and-forget from the read path.
 *
 * Each entry is attempted at most once: `enrich_attempted_at` is stamped
 * whether or not a payload was obtained (an `Update` redelivery still
 * re-enriches through the ingest path). Dependencies are injected so the batch
 * logic is unit-testable offline.
 */
import type { FeedStructuredPost } from '@aurboda/api-spec'

import type { UnenrichedTimelineEntry } from '../db/index.ts'

import { capabilityTokenFrom, parseAurbodaFeedUrl } from './activitypub/timeline-enrich.ts'

/** Attempts per timeline read — enough to drain a backlog over a few visits without stalling anything. */
const RETRO_BATCH_SIZE = 3

/**
 * Transient failures allowed per entry before it is stamped out of the
 * candidate set anyway — the candidates are newest-first, so a permanently
 * unreachable peer would otherwise hold the head of the queue and starve every
 * older entry behind it (#1019 review).
 */
export const MAX_TRANSIENT_ATTEMPTS = 3

/**
 * Fire-and-forget trigger for the lazy retro-enrichment pass, threaded from
 * `api.ts` (where the enricher and its origin live) to the timeline read
 * surfaces (REST `GET /feed/timeline`, MCP `list_timeline`). Never blocks the
 * read; enriched entries render natively on the next load.
 */
export type RetroEnrichTrigger = (user: string) => void

export interface RetroEnrichDeps {
  listUnenriched: (user: string, limit: number) => Promise<UnenrichedTimelineEntry[]>
  /** Store the payload (or just stamp the attempt when null) for one entry. */
  save: (user: string, id: string, structured: FeedStructuredPost | null) => Promise<void>
  /**
   * Record a transient failure: bump the entry's attempt counter, stamping it
   * out of the candidate set once `maxAttempts` is reached.
   */
  recordTransientFailure: (user: string, id: string, maxAttempts: number) => Promise<void>
  /**
   * One enrichment attempt. `null` is DEFINITIVE (non-Aurboda / gone /
   * unauthorized / malformed — stamped, never retried); a THROW is transient
   * (network, timeout, 5xx — retried up to {@link MAX_TRANSIENT_ATTEMPTS}).
   */
  enrich: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>
}

/**
 * Give up to `batchSize` eligible entries one enrichment attempt each,
 * sequentially (a read should trigger a trickle, not a burst against a peer).
 * Returns how many entries actually gained a payload.
 */
export const retroEnrichTimelineEntries = async (
  user: string,
  deps: RetroEnrichDeps,
  batchSize: number = RETRO_BATCH_SIZE,
): Promise<number> => {
  const candidates = await deps.listUnenriched(user, batchSize)
  let enriched = 0
  for (const entry of candidates) {
    // The SQL LIKE is a coarse prefilter — skip (and stamp) anything that isn't
    // actually an Aurboda feed object, so it never comes back as a candidate.
    if (parseAurbodaFeedUrl(entry.object_uri) == null) {
      await deps.save(user, entry.id, null)
      continue
    }
    try {
      const structured = await deps.enrich(entry.object_uri, capabilityTokenFrom(entry.images ?? []))
      await deps.save(user, entry.id, structured)
      if (structured != null) enriched++
    } catch (error) {
      // Transient (peer blip / timeout / 5xx): keep the entry retryable, but
      // bounded — a dead host must not hold the queue head forever (#1014).
      console.warn(`⚠️ timeline retro-enrichment attempt failed for ${entry.object_uri}:`, error)
      await deps.recordTransientFailure(user, entry.id, MAX_TRANSIENT_ATTEMPTS)
    }
  }
  return enriched
}
