/**
 * The instance actor's side of the public tag pages: what a followed tag actor
 * (`<tag>@tags.pub`) announces is kept centrally for `/tags/<tag>`. Delivered to
 * the instance actor's inbox or to the shared inbox, where there is no
 * recipient; a per-user delivery never reaches these handlers.
 *
 * The guards mirror a boost card's (`federation.ts`): only an accepted, followed
 * tag actor's `Announce` counts; the Note and its author are fetched from their
 * own ids, never read off the activity; the Note must be addressed `to` the
 * Public collection (an unlisted or non-public post never lands on a public page),
 * carry the followed tag itself, not be a reply or behind a content warning, and
 * be on its author's host.
 */
import type { InboxContext } from '@fedify/fedify'

import { Announce, type Delete, type Note, PUBLIC_COLLECTION, type Undo } from '@fedify/fedify/vocab'

import { INSTANCE_ACTOR_ID, isInstanceActor, type PublicTagIngest } from './instance-actor.ts'
import { fetchActorPresentation, resolveAnnouncedNote, validateAnnounce } from './remote-lookup.ts'
import { temporalInstantToDate } from './temporal-interop.ts'
import { extractNoteImages, noteHashtags, noteLinkUrl, sanitizeRemoteHtml } from './timeline-ingest.ts'

/** Whether the delivery is the instance actor's: its own inbox, or the shared inbox. */
export const isInstanceDelivery = (ctx: Pick<InboxContext<void>, 'recipient'>): boolean =>
  ctx.recipient == null || isInstanceActor(ctx.recipient)

/** Public, not unlisted: an unlisted post names the Public collection only in `cc`. */
const isAddressedToPublic = (note: Note): boolean =>
  note.toIds.some((uri) => uri.href === PUBLIC_COLLECTION.href)

const hasContentWarning = (note: Note): boolean =>
  note.sensitive === true || (note.summary?.toString().trim() ?? '') !== ''

export const handleInstanceActorAnnounce = async (
  ctx: InboxContext<void>,
  announce: Announce,
  deps: PublicTagIngest,
  now: () => Date = () => new Date(),
): Promise<void> => {
  const valid = validateAnnounce(announce)
  if (valid == null) return
  const followed = await deps.followedTagActor(valid.actorId.href)
  if (followed == null) return
  const announced = await resolveAnnouncedNote(ctx, INSTANCE_ACTOR_ID, valid.objectId)
  if (announced == null) return
  const { attributionId, note } = announced
  if (!isAddressedToPublic(note) || note.replyTargetIds.length > 0 || hasContentWarning(note)) return
  if (note.id == null || note.id.host !== attributionId.host) return
  const tags = await noteHashtags(note)
  if (!tags.includes(followed.tag)) return
  const author = await fetchActorPresentation(ctx, INSTANCE_ACTOR_ID, attributionId)
  if (author == null) return
  const published = note.published == null ? now() : temporalInstantToDate(note.published)
  await deps.upsertPublicTagPost({
    ...author,
    actor_uri: attributionId.href,
    announce_uris: [valid.announceUri],
    content: sanitizeRemoteHtml(note.content?.toString() ?? ''),
    images: await extractNoteImages(note),
    local_user: null,
    note_uri: announced.uri,
    published_at: new Date(Math.min(published.getTime(), now().getTime())),
    tags,
    url: noteLinkUrl(note, note.id),
  })
}

/** A followed tag actor withdrawing its `Announce`: matched on the Announce id, scoped to that actor. */
export const handleInstanceActorUndo = async (
  ctx: InboxContext<void>,
  undo: Undo,
  deps: PublicTagIngest,
): Promise<void> => {
  if (undo.actorId == null) return
  const followed = await deps.followedTagActor(undo.actorId.href)
  if (followed == null) return
  const inner = await undo.getObject({ suppressError: true })
  if (inner != null && !(inner instanceof Announce)) return
  if (inner instanceof Announce && inner.actorId?.href !== undo.actorId.href) return
  const announceUri = inner?.id?.href ?? undo.objectId?.href
  if (announceUri == null || new URL(announceUri).host !== undo.actorId.host) return
  await deps.removePublicTagAnnounce(announceUri)
}

/**
 * The author deleting their post, scoped to the sender like the timeline's Delete,
 * or deleting themselves (the object is the actor), which takes every post of theirs.
 */
export const handleInstanceActorDelete = async (
  _ctx: InboxContext<void>,
  del: Delete,
  deps: PublicTagIngest,
): Promise<void> => {
  if (del.objectId == null || del.actorId == null) return
  if (del.objectId.href === del.actorId.href) await deps.deletePublicTagPostsByActor(del.actorId.href)
  else await deps.deletePublicTagPost(del.objectId.href, del.actorId.href)
}
