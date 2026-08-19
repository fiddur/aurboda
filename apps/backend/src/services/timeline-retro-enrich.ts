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

export interface RetroEnrichDeps {
  listUnenriched: (user: string, limit: number) => Promise<UnenrichedTimelineEntry[]>
  /** Store the payload (or just stamp the attempt when null) for one entry. */
  save: (user: string, id: string, structured: FeedStructuredPost | null) => Promise<void>
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
    const structured = await deps.enrich(entry.object_uri, capabilityTokenFrom(entry.images ?? []))
    await deps.save(user, entry.id, structured)
    if (structured != null) enriched++
  }
  return enriched
}
