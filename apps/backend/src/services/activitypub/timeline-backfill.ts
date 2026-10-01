/**
 * When a follow WE sent becomes accepted, fetch the followee's recent PUBLIC
 * posts from their ActivityPub outbox and ingest them into the follower's home
 * timeline — so the timeline isn't empty until the followee next posts. The
 * outbox only carries `public`/`unlisted` posts, so followers-only and older
 * private posts are correctly never backfilled. Servers whose outbox lists no
 * items get a fallback: for FitPub (detected via NodeInfo) the post ids come
 * from its public web API — see `fitpub-backfill.ts`.
 *
 * Best-effort throughout: a followee whose outbox is unreachable, private, or
 * slow simply yields no backfill — it never blocks or fails the follow. The
 * orchestration (`backfillFolloweeTimeline`) is Fedify- and DB-free via injected
 * deps, so it unit-tests without network or a database; the thin Fedify outbox
 * fetch and the FitPub fallback are the only pieces that talk to the wire.
 */
import type { Context, Federation } from '@fedify/fedify'

import { type Actor, Collection, Create, isActor, Note } from '@fedify/fedify/vocab'

import { type FeedFollowingRecord, getFeedFollowingByActor } from '../../db/index.ts'
import { safeFetchGet } from '../safe-fetch.ts'
import { withTimeout } from '../with-timeout.ts'
import { ingestNoteForRecipient } from './federation.ts'
import { fetchFitpubRecentNotes } from './fitpub-backfill.ts'
import { createAurbodaEnricher } from './timeline-enrich.ts'

/** Most recent posts pulled from a followee's outbox on backfill. */
const BACKFILL_LIMIT = 20
/** Cap on outbox items scanned to find `BACKFILL_LIMIT` Notes — bounds a huge/cyclic outbox. */
const MAX_SCANNED = 80
/** Whole-backfill timeout so a slow outbox can't keep the task alive indefinitely. */
const BACKFILL_TIMEOUT_MS = 15_000

export interface BackfillDeps {
  /** Up to `limit` of the actor's most recent public Notes, newest-first (best-effort). */
  fetchRecentNotes: (actorUri: string, limit: number) => Promise<Note[]>
  getFollowee: (user: string, actorUri: string) => Promise<FeedFollowingRecord | null>
  ingestNote: (user: string, note: Note, followee: FeedFollowingRecord) => Promise<void>
}

/**
 * Backfill `user`'s timeline with the followee's recent public posts, returning
 * the number ingested. Skips silently unless the row is (still) an accepted
 * follow, and never throws — a failed outbox fetch or a single bad note just
 * yields fewer posts.
 */
export const backfillFolloweeTimeline = async (
  deps: BackfillDeps,
  user: string,
  actorUri: string,
  limit: number = BACKFILL_LIMIT,
): Promise<number> => {
  let followee: FeedFollowingRecord | null
  try {
    followee = await deps.getFollowee(user, actorUri)
  } catch {
    return 0
  }
  if (followee == null || !followee.accepted) return 0

  let notes: Note[]
  try {
    notes = await deps.fetchRecentNotes(actorUri, limit)
  } catch {
    return 0
  }

  let ingested = 0
  for (const note of notes) {
    try {
      await deps.ingestNote(user, note, followee)
      ingested++
    } catch {
      // One unresolvable / malformed note shouldn't abort the rest of the page.
    }
  }
  return ingested
}

/**
 * Fetch up to `limit` of an actor's most recent public Notes from their outbox,
 * using the federation context's document loader (the same signed-fetch path as
 * actor resolution). Bounded by `limit` Notes and `MAX_SCANNED` items so a huge
 * or cyclic outbox can't run away; any resolution failure yields fewer/no notes.
 * Outbox entries are usually `Create` activities wrapping the Note; some servers
 * also list bare Notes. Boosts and other activities are ignored.
 */
const fetchRecentOutboxNotes = async (ctx: Context<void>, actor: Actor, limit: number): Promise<Note[]> => {
  if (actor.outboxId == null) return []
  const outbox = await ctx.lookupObject(actor.outboxId)
  if (!(outbox instanceof Collection)) return []

  const notes: Note[] = []
  let scanned = 0
  for await (const item of ctx.traverseCollection(outbox, { suppressError: true })) {
    if (++scanned > MAX_SCANNED) break
    let note: Note | null = null
    if (item instanceof Note) note = item
    else if (item instanceof Create) {
      const object = await item.getObject({ suppressError: true })
      if (object instanceof Note) note = object
    }
    if (note != null) {
      notes.push(note)
      if (notes.length >= limit) break
    }
  }
  return notes
}

/**
 * The outbox first; only when it yields no Notes (FitPub serves a count-only
 * outbox) fall back to the FitPub post listing, which itself returns `[]` for
 * any server that isn't FitPub.
 */
const fetchRecentPublicNotes = async (
  federation: Federation<void>,
  origin: string,
  actorUri: string,
  limit: number,
): Promise<Note[]> => {
  const ctx = await federation.createContext(new URL(origin))
  const actor = await ctx.lookupObject(actorUri)
  if (!isActor(actor)) return []
  const outboxNotes = await fetchRecentOutboxNotes(ctx, actor, limit).catch((): Note[] => [])
  if (outboxNotes.length > 0) return outboxNotes

  try {
    return await fetchFitpubRecentNotes(
      {
        fetchJson: async (url) => (await safeFetchGet(url, { headers: { Accept: 'application/json' } })).data,
        lookupNote: async (url) => {
          const object = await ctx.lookupObject(url)
          return object instanceof Note ? object : null
        },
      },
      actorUri,
      actor.preferredUsername?.toString() ?? null,
      limit,
    )
  } catch {
    return []
  }
}

/**
 * Production backfiller wired to Fedify (outbox fetch, FitPub fallback), the real enricher, and
 * the DB. Returns the fire-and-forget trigger to pass as `createFeedFederation`'s
 * `onFollowAccepted`: it time-boxes the whole backfill and swallows every error,
 * so a slow or hostile outbox can never affect inbox processing.
 */
export const createTimelineBackfiller = (
  federation: Federation<void>,
  origin: string,
): ((user: string, actorUri: string) => void) => {
  const enrich = createAurbodaEnricher(origin)
  const deps: BackfillDeps = {
    fetchRecentNotes: (actorUri, limit) => fetchRecentPublicNotes(federation, origin, actorUri, limit),
    getFollowee: getFeedFollowingByActor,
    ingestNote: async (user, note, followee) => {
      await ingestNoteForRecipient(user, note, followee, enrich, origin)
    },
  }
  return (user, actorUri) => {
    void withTimeout(backfillFolloweeTimeline(deps, user, actorUri), BACKFILL_TIMEOUT_MS)
      .then((count) => {
        if (count > 0) {
          console.info(`📥 Backfilled ${count} post(s) from ${actorUri} into ${user}'s timeline`)
        }
      })
      .catch(() => {
        // Best-effort — a timeout or fetch failure just means no backfill.
      })
  }
}
