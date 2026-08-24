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

/**
 * Reply/Mention state parsed from a fetched AS2 object (#1060): the
 * `inReplyTo` id and whether a `Mention` tag points at `myActorUri`. Exported
 * pure for tests.
 */
export const parseReplyInfo = (
  doc: unknown,
  myActorUri: string,
): { in_reply_to_uri: string | null; mentions_me: boolean } => {
  if (typeof doc !== 'object' || doc == null || Array.isArray(doc)) {
    return { in_reply_to_uri: null, mentions_me: false }
  }
  const rec = doc as Record<string, unknown>
  const reply = rec.inReplyTo
  const inReplyToUri =
    typeof reply === 'string'
      ? reply
      : typeof reply === 'object' &&
          reply != null &&
          typeof (reply as Record<string, unknown>).id === 'string'
        ? ((reply as Record<string, unknown>).id as string)
        : null
  const tags = Array.isArray(rec.tag) ? rec.tag : rec.tag == null ? [] : [rec.tag]
  const mentionsMe = tags.some(
    (t) =>
      typeof t === 'object' &&
      t != null &&
      (t as Record<string, unknown>).type === 'Mention' &&
      (t as Record<string, unknown>).href === myActorUri,
  )
  return { in_reply_to_uri: inReplyToUri, mentions_me: mentionsMe }
}

export interface ReplyBackfillDeps {
  listUnchecked: (user: string, limit: number) => Promise<{ id: string; object_uri: string }[]>
  saveReplyInfo: (user: string, id: string, inReplyToUri: string | null, mentionsMe: boolean) => Promise<void>
  /** SSRF-guarded ActivityPub fetch of the object, or null on any failure. */
  fetchObject: (objectUri: string) => Promise<unknown | null>
}

/**
 * Backfill reply/Mention state for entries ingested before #1060 tracked it —
 * so a legacy reply stops rendering as a top-level card once the setting hides
 * replies. One attempt per entry (`reply_checked_at` stamps whatever the
 * outcome — an unreachable object stays a plain card, which is what it already
 * was), a small batch per timeline read, sequential like the enrichment pass.
 */
export const backfillReplyLinks = async (
  user: string,
  myActorUri: string,
  deps: ReplyBackfillDeps,
  batchSize: number = RETRO_BATCH_SIZE,
): Promise<void> => {
  const candidates = await deps.listUnchecked(user, batchSize)
  for (const entry of candidates) {
    const doc = await deps.fetchObject(entry.object_uri)
    const info = parseReplyInfo(doc, myActorUri)
    await deps.saveReplyInfo(user, entry.id, info.in_reply_to_uri, info.mentions_me)
  }
}
