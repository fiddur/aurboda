/**
 * Fetching what a received activity only names — the sender's actor document,
 * the Note an `Announce` points at — from its own id, never from the activity
 * body. Shared by the per-user inbox (`federation.ts`) and the instance actor's
 * public tag ingest (`public-tag-ingest.ts`).
 */
import type { InboxContext } from '@fedify/fedify'

import { type Announce, isActor, Note } from '@fedify/fedify/vocab'

import { withTimeout } from '../with-timeout.ts'
import { type ActorPresentation, extractActorPresentation } from './actor-presentation.ts'
import { signedFetchOptions } from './signed-lookup.ts'

const ACTOR_LOOKUP_TIMEOUT_MS = 5_000

/**
 * A sending actor's presentation snapshot (handle / display name / avatar),
 * **fetched from their id** — null when that id doesn't answer with that very
 * actor.
 *
 * Never read off an actor inlined in the delivered activity. An embedded actor
 * is attacker-controlled: any `preferredUsername`/`name` can ride along under a
 * valid id, and every snapshot we store becomes a byline someone reads. Fetching
 * by id makes the claimed actor's own server the only thing that can describe
 * them, and the returned document must still carry exactly that id
 * (`lookupObject` also refuses a cross-origin `@id`). Each caller decides what a
 * null means: a countable-but-anonymous reaction, a follow with no display
 * fields, or dropping the activity outright.
 */
export const fetchActorPresentation = async (
  ctx: InboxContext<void>,
  /** The local actor the fetch is signed as. */
  user: string,
  actorId: URL,
): Promise<ActorPresentation | null> => {
  const actor = await withTimeout(
    signedFetchOptions(ctx, user).then((options) => ctx.lookupObject(actorId, options)),
    ACTOR_LOOKUP_TIMEOUT_MS,
  ).catch(() => null)
  if (!isActor(actor) || actor.id?.href !== actorId.href) return null
  return await extractActorPresentation(actor)
}

/** How long to wait for a boosted Note (usually a bare id Mastodon expects us to fetch). */
const BOOST_OBJECT_TIMEOUT_MS = 10_000

export interface AnnouncedNote {
  note: Note
  /** The announced Note's own id — the boost card's `boost_of_uri`. */
  uri: string
  attributionId: URL
}

/**
 * The Note an `Announce` points at, **always fetched from `announce.objectId`**
 * — an object embedded in the activity body is ignored outright.
 *
 * That is the whole security of a boost card. `announce.getObject()` hands back
 * an inlined object without any fetch, so a followee could deliver an `Announce`
 * carrying a `Note` with any `id` and `attributedTo` they chose, and every
 * downstream check (id host, attribution host, author id) would be satisfied by
 * data they wrote — storing forged content under a real person's handle.
 * Dereferencing by id makes the claimed origin server the only source of the
 * post's content and byline. Mastodon sends a bare id anyway, so this is also
 * the normal path.
 *
 * Two further rejections: the fetched object must be a `Note` whose id is on the
 * **same host as the announced id** (a redirect can't swap in a document from
 * somewhere else — `lookupObject` refuses a cross-origin `@id` too), and it must
 * declare `attributedTo` (there is no other honest source for the author).
 */
export const resolveAnnouncedNote = async (
  ctx: InboxContext<void>,
  me: string,
  objectId: URL,
): Promise<AnnouncedNote | null> => {
  const note = await withTimeout(
    signedFetchOptions(ctx, me).then((options) => ctx.lookupObject(objectId, options)),
    BOOST_OBJECT_TIMEOUT_MS,
  ).catch(() => null)
  if (!(note instanceof Note) || note.id == null || note.id.host !== objectId.host) return null
  const attributionId = note.attributionIds[0]
  return attributionId == null ? null : { attributionId, note, uri: note.id.href }
}

export interface ValidatedAnnounce {
  actorId: URL
  /** The `Announce`'s own id — the boost card's `object_uri`. */
  announceUri: string
  objectId: URL
}

/**
 * The `Announce`'s own identity, or null when it can't back a boost card.
 *
 * Beyond the ids simply being present, the activity id must be **on the
 * booster's host**: it becomes the card's `object_uri`, which is the GLOBAL
 * upsert key, so it needs the same origin check `noteToTimelineInput` applies
 * to a direct Note's id. Without it an accepted followee could announce a real
 * third-party post under an id equal to another followee's existing entry and
 * overwrite that entry with a boost card of their choosing (then evict it with
 * an `Undo{Announce}`, since the row would name them as the booster). Mastodon
 * mints `…/statuses/<n>/activity` on the actor's own host.
 */
export const validateAnnounce = (announce: Announce): ValidatedAnnounce | null => {
  const { actorId, id, objectId } = announce
  if (actorId == null || id == null || objectId == null) return null
  return id.host === actorId.host ? { actorId, announceUri: id.href, objectId } : null
}
