import type { Actor } from '@fedify/fedify/vocab'

import { type FeedReactionKind, type FeedStructuredPost, normalizeTags } from '@aurboda/api-spec'
import {
  type Context,
  createFederation,
  type Federation,
  type InboxContext,
  MemoryKvStore,
} from '@fedify/fedify'
import {
  Accept,
  Announce,
  Create,
  Delete,
  Follow,
  Image,
  Like,
  Note,
  Person,
  QuoteAuthorization,
  QuoteRequest,
  Reject,
  Tombstone,
  Undo,
  Update,
} from '@fedify/fedify/vocab'

import type { ActorPresentation } from './actor-presentation.ts'

/**
 * Single actor per user: the actor identifier IS the username, and the actor
 * lives at `<host>/users/<username>` — a dedicated prefix that never collides
 * with the SPA's human-facing `/u/<username>` profile/dashboard pages.
 */
import { isValidUsername } from '../../api/auth-routes.ts'
import {
  countAcceptedFeedFollowing,
  type FeedQuoteAuthorizationRecord,
  countFeedFollowers,
  countPublicFeedPosts,
  deleteBoostEntry,
  deleteFeedQuoteAuthorizationsByActor,
  deleteFeedQuoteAuthorizationsByQuote,
  deleteTimelineEntryByUri,
  getFeedFollowerByActor,
  deleteBoostCardsOf,
  getBoostCardAuthor,
  updateBoostCardsOf,
  getFeedFollowingByActor,
  getFeedPostById,
  getFeedQuoteAuthorization,
  getOrCreateActorKeyPair,
  getProfileAvatarVersion,
  getTimelineEntryByObjectUri,
  getUserSettings,
  hasCachedActorPresentation,
  isMissingDatabase,
  isTimelineEntryVisible,
  listAcceptedFeedFollowing,
  listFeedFollowers,
  listPublicFeedPostsPage,
  markFeedFollowingAccepted,
  removeFeedFollower,
  removeFeedFollowingByActor,
  removeFeedPostReaction,
  removeFeedPostReactionByActivity,
  updateFeedFollowerPresentation,
  updateFeedFollowingPresentation,
  updateFeedPostReactionPresentation,
  updateTimelineActorPresentation,
  upsertFeedFollower,
  upsertFeedPostReaction,
  upsertFeedQuoteAuthorization,
  upsertTimelineEntry,
} from '../../db/index.ts'
import { UUID_RE } from '../../utils.ts'
import { resolveFeedActivity } from '../feed.ts'
import { buildProfileUrl } from '../share-urls.ts'
import { ownActorUri, ownObjectPrefix } from '../timeline.ts'
import { dashboardNoteContent } from './dashboard-object.ts'
import {
  buildArticleNote,
  buildArticleNoteCreate,
  buildChallengeNote,
  buildChallengeNoteCreate,
  buildDashboardNote,
  buildDashboardNoteCreate,
  buildExerciseNote,
  buildExerciseNoteCreate,
  buildFeedCreate,
  buildFeedNote,
  buildReplyNote,
  buildReplyNoteCreate,
  deliverToRelays,
  type FeedDeliveryDeps,
  toDeliverableArticle,
  toDeliverableChallenge,
  toDeliverableDashboard,
  toDeliverableExercise,
  toDeliverableReply,
} from './deliver.ts'
import { exerciseNoteContent } from './exercise-object.ts'
import {
  buildInstanceActor,
  handleInstanceActorFollow,
  handleRelayResponse,
  handleTagFollowResponse,
  INSTANCE_ACTOR_ID,
  INSTANCE_ACTOR_PATH,
  type InstanceActorDeps,
  instanceActorUsername,
  isInstanceActor,
  type PublicTagIngest,
  type RelayInboxHooks,
} from './instance-actor.ts'
import { toCryptoKeyPair } from './keys.ts'
import { AS_PUBLIC, isPubliclyVisible } from './object.ts'
import {
  handleInstanceActorAnnounce,
  handleInstanceActorDelete,
  handleInstanceActorUndo,
  isInstanceDelivery,
} from './public-tag-ingest.ts'
import { fetchActorPresentation, resolveAnnouncedNote, validateAnnounce } from './remote-lookup.ts'
import { temporalInstantToDate } from './temporal-interop.ts'
import { capabilityTokenFrom, createAurbodaEnricher } from './timeline-enrich.ts'
import {
  extractNoteImages,
  noteHashtags,
  noteMentionsActor,
  noteToTimelineInput,
  type TimelineAuthor,
  type TimelineBoostSource,
} from './timeline-ingest.ts'

const OUTBOX_PAGE_SIZE = 20

/**
 * The local follower (inbox owner) that an `Accept`/`Reject` response to a Follow
 * WE sent belongs to. Derived from the inner Follow's `actor` (which is our
 * actor), so it works whether the response lands on the personal OR a shared
 * inbox; falls back to `ctx.recipient` (null on the shared inbox) if the remote
 * didn't embed the Follow. `suppressError` so an unresolvable inner object yields
 * null rather than throwing a 500 that invites retries. Returns null if no valid
 * local user can be determined.
 */
const localFollowerIdentifier = async (
  ctx: InboxContext<void>,
  response: Accept | Reject,
): Promise<string | null> => {
  const object = await response.getObject({ suppressError: true })
  if (object instanceof Follow && object.actorId != null) {
    const parsed = ctx.parseUri(object.actorId)
    if (parsed?.type === 'actor' && isValidUsername(parsed.identifier)) return parsed.identifier
  }
  const recipient = ctx.recipient
  return recipient != null && isValidUsername(recipient) ? recipient : null
}

const NO_PRESENTATION: ActorPresentation = { avatar_url: null, display_name: null, handle: null }

/**
 * Persist an inbound follower and decide whether to accept it now. Auto-accepts
 * unless the target user requires manual approval — but an already *accepted*
 * follower re-sending a Follow stays accepted (a re-delivery never demotes them).
 * Caches the follower's presentation (so the approval UI can show who's asking)
 * and the Follow's id (echoed in a deferred Accept/Reject). Returns the acceptance
 * decision, or null if the target user's DB doesn't exist (a Follow to a
 * nonexistent actor — ignore it) or the sender lacks an id/inbox.
 *
 * The presentation is fetched from the follower's actor **id**
 * (`fetchActorPresentation`), never read off the actor inlined in the Follow —
 * that snapshot is the byline of the approval UI and the followers list. An
 * unreadable actor document still records the follow (the relationship is real,
 * and losing it would be worse than an unnamed row); only the display fields
 * stay unknown. The inbox URIs still come from the actor Fedify resolved for the
 * signature-verified sender: that is delivery addressing, not presentation.
 */
const recordInboundFollow = async (
  ctx: InboxContext<void>,
  user: string,
  sender: Actor,
  followActivityUri: string | null,
): Promise<boolean | null> => {
  if (sender.id == null || sender.inboxId == null) return null
  try {
    const settings = await getUserSettings(user)
    const existing = await getFeedFollowerByActor(user, sender.id.href)
    const accepted = existing?.accepted === true || settings?.manually_approve_followers !== true
    const presentation = (await fetchActorPresentation(ctx, user, sender.id)) ?? NO_PRESENTATION
    await upsertFeedFollower(user, {
      accepted,
      actor_uri: sender.id.href,
      avatar_url: presentation.avatar_url,
      display_name: presentation.display_name,
      follow_activity_uri: followActivityUri,
      handle: presentation.handle,
      inbox_uri: sender.inboxId.href,
      shared_inbox_uri: sender.endpoints?.sharedInbox?.href ?? null,
    })
    return accepted
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
}

/**
 * Whether a just-stored entry is one the reader would actually SEE, under their
 * own `timeline_show_replies` setting — the gate on the live "new post" ping
 * (#1062). Without it a hidden reply pings the web/app to reveal a card that
 * their timeline doesn't list. Best-effort: an unreadable setting falls back to
 * the default (replies to posts outside the timeline hidden), exactly as the
 * page read does.
 */
const isVisibleToReader = async (user: string, entryId: string, origin: string): Promise<boolean> => {
  const settings = await getUserSettings(user).catch(() => null)
  return isTimelineEntryVisible(user, entryId, {
    own_object_prefix: ownObjectPrefix(origin, user),
    show_replies: settings?.timeline_show_replies === true,
  })
}

/**
 * Ingest one `Note` from an accepted followee into `user`'s home timeline: map it
 * to a timeline entry (author from the cached `feed_following` row, content
 * sanitised), capture its image attachments, best-effort fetch the native Aurboda
 * structured chart, and upsert keyed on the Note's id (so a redelivery or edit
 * replaces in place). `onNewEntry` fires only for a genuinely new row the reader
 * would see — the on-follow backfill omits it, since its historical posts aren't
 * "new".
 *
 * Shared by inbound `Create`/`Update` delivery and the backfill, so both build a
 * timeline entry identically. Returns whether the Note was stored at all (it is
 * dropped when it fails `noteToTimelineInput`'s authority check).
 */
export const ingestNoteForRecipient = async (
  user: string,
  note: Note,
  author: TimelineAuthor,
  enrich: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>,
  /** Web origin — the recipient's own actor URI (Mention detection) and post prefix. */
  origin: string,
  onNewEntry?: (user: string) => void,
  /** When set, the row becomes a BOOST card of `note` (an `Announce` by a followee). */
  boost?: TimelineBoostSource,
): Promise<boolean> => {
  const input = noteToTimelineInput(note, author, Date.now(), boost)
  if (input == null) return false
  // Capture the Note's image attachments (rendered chart / route map, or a
  // Mastodon photo) so the timeline can show them when there's no native chart.
  const images = await extractNoteImages(note)
  // A Mention of the recipient keeps the post visible + notifying whatever the
  // reply setting says (Mastodon-style involvement).
  const mentionsMe = await noteMentionsActor(note, ownActorUri(origin, user))
  // Best-effort: fetch the native structured payload if this is an Aurboda post
  // (null otherwise). A followers-only post authorizes the fetch with the same
  // capability token embedded in its delivered image URL. Stored on the entry so
  // the web can render a native chart in place of the image. Keyed on the NOTE's
  // id — on a boost card `object_uri` is the Announce id, which no peer serves.
  const structured = await enrich(input.boost_of_uri ?? input.object_uri, capabilityTokenFrom(images))
  const declaredTags = await noteHashtags(note)
  const tags = boost?.tag == null ? declaredTags : normalizeTags([boost.tag, ...declaredTags])
  const { id, inserted } = await upsertTimelineEntry(user, {
    ...input,
    images,
    mentions_me: mentionsMe,
    structured,
    tags,
  })
  if (input.boost_of_uri == null) await deleteBoostCardsOf(user, input.object_uri)
  if (inserted && onNewEntry != null && (await isVisibleToReader(user, id, origin))) onNewEntry(user)
  return true
}

/**
 * The local feed-post id an inbound `Like`/`Announce` targets, or null when its
 * object isn't one of the recipient's OWN post Notes. The `identifier === me`
 * check is the authorization: a reaction addressed to someone else's post (or to
 * a non-post URL on this host) must never touch this user's records.
 */
const ownTargetPostId = (ctx: InboxContext<void>, objectId: URL | null, me: string): string | null => {
  if (objectId == null) return null
  const parsed = ctx.parseUri(objectId)
  if (parsed?.type !== 'object' || parsed.class !== Note) return null
  const identifier = parsed.values.identifier
  const postId = parsed.values.postId
  if (identifier !== me || !isValidUsername(identifier) || postId == null || !UUID_RE.test(postId)) {
    return null
  }
  return postId
}

/**
 * Record an inbound `Like`/`Announce` of one of the recipient's OWN posts, so
 * the owner can see who favourited / boosted it. Open to any sender (Mastodon
 * doesn't require a follow to favourite), but strictly scoped to a post that is
 * ours and still exists.
 *
 * The presentation snapshot is fetched from the sender's actor **id** (see
 * `fetchActorPresentation`). Best-effort — an unresolvable actor still leaves a
 * countable reaction, just an anonymous one.
 */
const recordOwnPostReaction = async (
  ctx: InboxContext<void>,
  activity: Announce | Like,
  kind: FeedReactionKind,
): Promise<void> => {
  const me = ctx.recipient
  if (me == null || !isValidUsername(me) || activity.actorId == null) return
  const postId = ownTargetPostId(ctx, activity.objectId, me)
  if (postId == null) return
  try {
    if ((await getFeedPostById(me, postId)) == null) return
    const presentation = (await fetchActorPresentation(ctx, me, activity.actorId)) ?? NO_PRESENTATION
    await upsertFeedPostReaction(me, {
      activity_uri: activity.id?.href ?? null,
      actor_uri: activity.actorId.href,
      avatar_url: presentation.avatar_url,
      display_name: presentation.display_name,
      handle: presentation.handle,
      kind,
      post_id: postId,
    })
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
}

/**
 * The boosted Note's author, for the boost card's snapshot: the cached
 * `feed_following` row when we already follow them (no network), else the actor
 * document **fetched from the attribution id**.
 *
 * Never `note.getAttribution()`: Fedify returns an actor inlined in the Note
 * without fetching anything, so a hostile booster could embed a `Person` with
 * any `preferredUsername`/`name` under a real person's id and we would store a
 * forged byline — hence `fetchActorPresentation`. An author we can't verify means
 * no boost card at all: showing someone's post under an unverified name is worse
 * than not showing it.
 */
const resolveBoostAuthor = async (
  ctx: InboxContext<void>,
  me: string,
  attributionId: URL,
): Promise<TimelineAuthor | null> => {
  const followed = await getFeedFollowingByActor(me, attributionId.href)
  if (followed != null) return followed
  const presentation = await fetchActorPresentation(ctx, me, attributionId)
  return presentation == null ? null : { ...presentation, actor_uri: attributionId.href }
}

/**
 * A followee boosted somebody else's post → a **boost card** in our timeline
 * (Mastodon's "🔄 X boosted"). The card is its own row keyed on the `Announce`
 * id, describing the ORIGINAL post and author, with the booster in
 * `boosted_by_*` — see `TimelineBoostSource`.
 *
 * Guards, in order: the `Announce` must be self-consistent (see
 * `validateAnnounce` — its id is the card's upsert key); only an **accepted
 * followee** can boost into our timeline; the announced Note and its author are
 * **fetched from their own ids**, never taken from the activity body (see
 * `resolveAnnouncedNote`); the Note must be on the same host as the announced id
 * and declare `attributedTo`; and a post ALREADY in this timeline directly gets
 * no boost card (Mastodon hides a reblog of a post you have).
 */
const ingestBoostedNote = async (
  ctx: InboxContext<void>,
  announce: Announce,
  origin: string,
  onNewEntry?: (user: string) => void,
  enrich: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null> = async () => null,
): Promise<void> => {
  const me = ctx.recipient
  const valid = validateAnnounce(announce)
  if (me == null || !isValidUsername(me) || valid == null) return
  try {
    const booster = await getFeedFollowingByActor(me, valid.actorId.href)
    if (booster == null || !booster.accepted) return
    const announced = await resolveAnnouncedNote(ctx, me, valid.objectId)
    if (announced == null) return
    if ((await getTimelineEntryByObjectUri(me, announced.uri)) != null) return
    const author = await resolveBoostAuthor(ctx, me, announced.attributionId)
    if (author == null) return
    await ingestNoteForRecipient(me, announced.note, author, enrich, origin, onNewEntry, {
      actor_uri: booster.actor_uri,
      announce_uri: valid.announceUri,
      display_name: booster.display_name,
      handle: booster.handle,
      tag: booster.tag,
      published_at: announce.published == null ? new Date() : temporalInstantToDate(announce.published),
    })
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
}

/**
 * Retract an inbound reaction whose inner `Like`/`Announce` resolved: drop the
 * `feed_post_reaction` row when it targeted one of OUR posts, and — for an
 * `Announce` — the boost card that Announce put in our timeline. Both deletes
 * are scoped to `undo.actorId`, so a signed Undo only ever removes its own
 * actor's reaction.
 */
const undoInboundReaction = async (
  ctx: InboxContext<void>,
  undo: Undo,
  inner: Announce | Like,
  kind: FeedReactionKind,
): Promise<void> => {
  const me = ctx.recipient
  if (me == null || !isValidUsername(me) || undo.actorId == null) return
  const postId = ownTargetPostId(ctx, inner.objectId, me)
  if (postId != null) await removeFeedPostReaction(me, postId, kind, undo.actorId.href)
  if (kind !== 'announce') return
  const announceUri = inner.id?.href ?? undo.objectId?.href
  if (announceUri != null) await deleteBoostEntry(me, announceUri, undo.actorId.href)
}

/**
 * Fallback retraction for an `Undo` whose inner object didn't resolve (a bare
 * activity URI the remote 404s after undoing): match on the activity id we
 * recorded. Scoped to the undoing actor, like every other retraction, and only
 * reached when there IS an `objectId` and nothing resolved from it.
 */
const undoReactionByActivityId = async (ctx: InboxContext<void>, undo: Undo): Promise<void> => {
  const me = ctx.recipient
  if (me == null || !isValidUsername(me) || undo.actorId == null || undo.objectId == null) return
  await removeFeedPostReactionByActivity(me, undo.objectId.href, undo.actorId.href)
  await deleteBoostEntry(me, undo.objectId.href, undo.actorId.href)
}

/**
 * Inbound `Follow` — someone asks to follow one of our actors: record them (see
 * `recordInboundFollow`) and answer with an `Accept` unless the owner approves
 * followers by hand. Exported like the other `handleInbound*` entry points so
 * the inbox behaviour is testable without forging an HTTP signature.
 *
 * The actor Fedify resolves here supplies the delivery addressing only (the
 * inbox we send the `Accept` to, and the inbox we cache); the follower's
 * PRESENTATION is fetched from their id inside `recordInboundFollow`.
 */
export const handleInboundFollow = async (
  ctx: InboxContext<void>,
  follow: Follow,
  relays?: RelayInboxHooks,
): Promise<void> => {
  if (follow.objectId == null) return
  const target = ctx.parseUri(follow.objectId)
  if (target?.type === 'actor' && isInstanceActor(target.identifier)) {
    return await handleInstanceActorFollow(ctx, follow, relays)
  }
  if (target?.type !== 'actor' || !isValidUsername(target.identifier)) return

  const sender = await follow.getActor(ctx)
  if (sender?.id == null || sender.inboxId == null) return

  const accepted = await recordInboundFollow(ctx, target.identifier, sender, follow.id?.href ?? null)
  // In manual-approval mode a new/pending follow gets no Accept yet — the
  // owner approves it later (which sends the Accept). `null` means no such
  // user (missing DB). Only an accepted follow is answered now, so the remote
  // server marks it established.
  if (accepted !== true) return
  await ctx.sendActivity(
    { identifier: target.identifier },
    sender,
    new Accept({ actor: follow.objectId, object: follow }),
  )
}

/**
 * Inbound `Like` — someone favourited one of our posts. Exported (like the
 * `Announce`/`Undo` entry points below) so the inbox behaviour is testable
 * without forging an HTTP signature: the listener is a one-line delegation.
 */
export const handleInboundLike = (ctx: InboxContext<void>, like: Like): Promise<void> =>
  recordOwnPostReaction(ctx, like, 'like')

/**
 * Inbound `Delete` on a user's own inbox. `del.objectId` is the removed object's id (a Tombstone or
 * bare id), and every effect is scoped to the sender (`del.actorId`) so a signed `Delete` from some
 * other actor can't evict a post it didn't author — mirroring how `Undo{Follow}` is scoped to its own
 * actor. A post we received leaves the timeline; a deleted quoting Note loses its stamp (FEP-044f),
 * and a deleted actor every stamp it held.
 */
export const handleInboundDelete = async (ctx: InboxContext<void>, del: Delete): Promise<void> => {
  const me = ctx.recipient
  if (me == null || !isValidUsername(me) || del.objectId == null || del.actorId == null) return
  try {
    await deleteTimelineEntryByUri(me, del.objectId.href, del.actorId.href)
    await deleteFeedQuoteAuthorizationsByQuote(me, del.objectId.href, del.actorId.href)
    if (del.objectId.href === del.actorId.href) {
      await deleteFeedQuoteAuthorizationsByActor(me, del.actorId.href)
    }
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
}

/**
 * FEP-044f: the `Accept`'s `result` is a stamp URL that the quoting server keeps and other
 * servers fetch to verify the quote. A request for anything but the recipient's own Note is
 * ignored rather than rejected, as with reactions.
 */
export const handleInboundQuoteRequest = async (
  ctx: InboxContext<void>,
  request: QuoteRequest,
): Promise<void> => {
  const target = quoteRequestTarget(ctx, request)
  if (target == null) return
  const sender = await request.getActor(ctx)
  if (sender?.id == null || sender.inboxId == null) return
  try {
    await ctx.sendActivity({ identifier: target.me }, sender, await answerQuoteRequest(ctx, request, target))
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
}

interface QuoteRequestTarget {
  me: string
  postId: string
  requester: URL
  quoteUri: URL
}

/** The recipient's own post a `QuoteRequest` targets, or null when it is not ours or the quote is cross-host. */
const quoteRequestTarget = (ctx: InboxContext<void>, request: QuoteRequest): QuoteRequestTarget | null => {
  const me = ctx.recipient
  const requester = request.actorId
  if (me == null || !isValidUsername(me) || requester == null) return null
  const postId = ownTargetPostId(ctx, request.objectId, me)
  const quoteUri = request.instrumentId
  if (postId == null || quoteUri == null || quoteUri.host !== requester.host) return null
  if (request.id != null && request.id.host !== requester.host) return null
  return { me, postId, quoteUri, requester }
}

const answerQuoteRequest = async (
  ctx: InboxContext<void>,
  request: QuoteRequest,
  { me, postId, quoteUri, requester }: QuoteRequestTarget,
): Promise<Accept | Reject> => {
  const actorUri = ctx.getActorUri(me)
  const reject = () =>
    new Reject({
      actor: actorUri,
      id: new URL(`${actorUri.href}#rejects/quote_requests/${crypto.randomUUID()}`),
      object: request,
    })
  const post = await getFeedPostById(me, postId)
  if (post == null || !isPubliclyVisible(post.visibility)) return reject()
  const row = await upsertFeedQuoteAuthorization(me, {
    actor_uri: requester.href,
    post_id: postId,
    quote_uri: quoteUri.href,
    request_uri: request.id?.href ?? null,
  })
  // The quote is already approved for its first requester: another actor gets no stamp of theirs.
  if (row.actor_uri !== requester.href) return reject()
  return new Accept({
    actor: actorUri,
    id: new URL(`${actorUri.href}#accepts/quote_requests/${row.id}`),
    object: request,
    result: ctx.getObjectUri(QuoteAuthorization, { identifier: me, stampId: row.id }),
  })
}

/** A stamp's approval row, or null when it is unknown or its post is gone or no longer public/unlisted. */
const loadValidStamp = async (
  identifier: string,
  stampId: string,
): Promise<FeedQuoteAuthorizationRecord | null> => {
  try {
    const row = await getFeedQuoteAuthorization(identifier, stampId)
    if (row == null) return null
    const post = await getFeedPostById(identifier, row.post_id)
    return post != null && isPubliclyVisible(post.visibility) ? row : null
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
}

/**
 * Inbound `Announce`. Two distinct meanings share the type: a boost of one of
 * OUR posts is a reaction to record (from anyone — a boost needs no follow); a
 * boost of a THIRD-PARTY post by an accepted followee is a boost card for our
 * timeline. Our own post never becomes a timeline entry of our own.
 */
export const handleInboundAnnounce = async (
  ctx: InboxContext<void>,
  announce: Announce,
  origin: string,
  onNewEntry?: (user: string) => void,
  enrich?: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>,
): Promise<void> => {
  const me = ctx.recipient
  if (me == null || !isValidUsername(me)) return
  if (ownTargetPostId(ctx, announce.objectId, me) != null) {
    return await recordOwnPostReaction(ctx, announce, 'announce')
  }
  await ingestBoostedNote(ctx, announce, origin, onNewEntry, enrich)
}

/**
 * The inbox's `Announce` listener: a delivery to the instance actor (or the
 * shared inbox) goes to the public tag pages; one to a user is a boost or a
 * reaction, even from the same tag actor.
 */
export const createAnnounceListener =
  ({
    isReadOnly,
    onUserAnnounce,
    publicTagPosts,
  }: {
    isReadOnly: (user: string) => Promise<boolean>
    onUserAnnounce: (ctx: InboxContext<void>, announce: Announce) => Promise<void>
    publicTagPosts?: PublicTagIngest
  }) =>
  async (ctx: InboxContext<void>, announce: Announce): Promise<void> => {
    if (publicTagPosts != null && isInstanceDelivery(ctx)) {
      return await handleInstanceActorAnnounce(ctx, announce, publicTagPosts)
    }
    if (await dropsForReadOnly(ctx, announce, isReadOnly)) return
    await onUserAnnounce(ctx, announce)
  }

/**
 * Inbound `Undo` of a Follow (drop the follower), a Like or an Announce (retract
 * the reaction, and for an Announce the boost card it created).
 *
 * `suppressError` so an unresolvable inner object (a bare activity URI the
 * remote 404s after undoing) yields null and falls back to matching on that id,
 * rather than throwing a 500 that invites retries. Mastodon embeds the full
 * activity, so the common case resolves.
 */
export const handleInboundUndo = async (ctx: InboxContext<void>, undo: Undo): Promise<void> => {
  if (undo.actorId == null) return
  const object = await undo.getObject({ suppressError: true })
  try {
    if (object instanceof Like) return await undoInboundReaction(ctx, undo, object, 'like')
    if (object instanceof Announce) return await undoInboundReaction(ctx, undo, object, 'announce')
    // Only an inner object that did NOT resolve falls back to matching on the
    // bare activity id. An `Undo` of anything else that resolved — an
    // `Undo{Block}`, say — retracts nothing of ours, so it issues no deletes.
    if (object == null) return await undoReactionByActivityId(ctx, undo)
    if (!(object instanceof Follow) || object.objectId == null) return
    const target = ctx.parseUri(object.objectId)
    if (target?.type !== 'actor' || !isValidUsername(target.identifier)) return
    await removeFeedFollower(target.identifier, undo.actorId.href)
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
}

/**
 * The stranger branch of {@link ingestFeedActivity}: admit a non-followee's
 * Note only when the recipient is INVOLVED — it replies to one of their own,
 * still existing posts, or Mentions them. The author snapshot comes from the
 * signature-verified sender actor. Returns whether the Note was admitted.
 */
const ingestStrangerInvolvement = async (
  ctx: InboxContext<void>,
  activity: Create | Update,
  object: Note,
  me: string,
  origin: string,
  enrich: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>,
  onNewEntry?: (user: string) => void,
): Promise<boolean> => {
  if (activity.actorId == null) return false
  const target = object.replyTargetIds[0]?.href
  const prefix = ownObjectPrefix(origin, me)
  const postId = target?.startsWith(prefix) ? target.slice(prefix.length) : null
  const isReplyToOwnPost =
    postId != null && UUID_RE.test(postId) && (await getFeedPostById(me, postId)) != null
  if (!isReplyToOwnPost) {
    const myActor = ownActorUri(origin, me)
    if (!(await noteMentionsActor(object, myActor))) return false
  }
  // Require EXPLICIT attribution to the signing actor BEFORE the actor fetch —
  // `noteToTimelineInput` enforces the same rule (#1018), but only after we'd
  // have paid a network round-trip for a Note we were always going to drop.
  if (!object.attributionIds.some((uri) => uri.href === activity.actorId?.href)) return false
  // Fedify verified the HTTP signature as `activity.actorId`; the byline comes
  // from THAT id's own actor document, never from an actor inlined in the
  // activity (see `fetchActorPresentation`). An unreadable actor drops the Note:
  // this whole branch exists to show who a stranger is, and an anonymous
  // stranger card in the timeline is worse than no card.
  const presentation = await fetchActorPresentation(ctx, me, activity.actorId)
  if (presentation == null) return false
  return await ingestNoteForRecipient(
    me,
    object,
    { ...presentation, actor_uri: activity.actorId.href },
    enrich,
    origin,
    onNewEntry,
  )
}

const ingestFeedActivity = async (
  ctx: InboxContext<void>,
  activity: Create | Update,
  origin: string,
  onNewEntry?: (user: string) => void,
  /** Best-effort fetch of the post's native Aurboda structured data (null if not an Aurboda post). */
  enrich: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null> = async () => null,
): Promise<void> => {
  // The recipient (whose timeline this is) comes from the personal inbox owner.
  // Unlike Accept/Reject there's no inner Follow to derive it from, so this relies
  // on personal-inbox delivery; `ctx.recipient` is null on a shared inbox. That's
  // fine today (the actor advertises no `sharedInbox`), but shared-inbox support
  // would need fanning a single delivery out to every local follower of the actor.
  const me = ctx.recipient
  if (me == null || !isValidUsername(me) || activity.actorId == null) return
  try {
    const follow = await getFeedFollowingByActor(me, activity.actorId.href)
    const object = await activity.getObject({ suppressError: true })
    if (!(object instanceof Note)) return
    if (follow != null && follow.accepted) {
      await ingestNoteForRecipient(me, object, follow, enrich, origin, onNewEntry)
    } else {
      const admitted = await ingestStrangerInvolvement(ctx, activity, object, me, origin, enrich, onNewEntry)
      if (!admitted && activity instanceof Update) await applyEditToBoostCards(me, activity, object, enrich)
    }
  } catch (error) {
    // A missing DB is not an error worth a 500: that would invite redelivery retries.
    if (isMissingDatabase(error)) return
    throw error
  }
}

/**
 * Carry a non-followee author's edit over to the boost cards of their Note,
 * whenever their server delivers the `Update` to us (who it reaches is the
 * author's server's choice, e.g. everyone who interacted with the post).
 *
 * Only the card's own author may rewrite it: the card is looked up by the
 * signature-verified sender as well as the Note, and `noteToTimelineInput`
 * then requires the Note to be on that author's host and attributed to them —
 * the same checks `resolveBoostAuthor` passed when the card was made.
 */
const applyEditToBoostCards = async (
  me: string,
  update: Update,
  note: Note,
  enrich: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>,
): Promise<void> => {
  if (note.id == null || update.actorId == null) return
  const author = await getBoostCardAuthor(me, note.id.href, update.actorId.href)
  if (author == null) return
  const input = noteToTimelineInput(note, author)
  if (input == null) return
  const images = await extractNoteImages(note)
  const structured = await enrich(note.id.href, capabilityTokenFrom(images))
  await updateBoostCardsOf(me, note.id.href, author.actor_uri, {
    content: input.content,
    images,
    structured,
    url: input.url ?? null,
  })
}

/**
 * Refresh every cached copy of a remote actor's presentation after an inbound
 * `Update{Person}` (#1057) — the mirror of the `Update{Person}` we deliver on a
 * profile change. Without it our snapshots of a followee's handle / display name
 * / avatar stay stale forever, since nothing else ever re-reads a remote actor.
 *
 * The new presentation is fetched from `update.actorId` (`fetchActorPresentation`
 * — the embedded `Person` is only ever the claim, never the source), and every
 * row updated is keyed on that same signature-verified actor URI, so an actor
 * can only ever rewrite their own byline. Best-effort: an unreadable actor
 * document leaves the snapshots as they were.
 */
const refreshRemoteActorPresentation = async (ctx: InboxContext<void>, update: Update): Promise<void> => {
  const me = ctx.recipient
  if (me == null || !isValidUsername(me) || update.actorId == null) return
  const actorUri = update.actorId.href
  try {
    // Nothing of ours mentions them: skip the outbound actor fetch (and the four
    // no-op UPDATEs). Any signed actor can deliver an `Update{Person}`, so
    // without this gate a stranger can make us dereference their document at
    // will (#1111).
    if (!(await hasCachedActorPresentation(me, actorUri))) return
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
  const presentation = await fetchActorPresentation(ctx, me, update.actorId)
  if (presentation == null) return
  try {
    await updateFeedFollowerPresentation(me, actorUri, presentation)
    await updateFeedFollowingPresentation(me, actorUri, presentation)
    await updateTimelineActorPresentation(me, actorUri, presentation)
    await updateFeedPostReactionPresentation(me, actorUri, presentation)
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
}

/**
 * Whether an `Update` is a remote actor editing THEMSELVES: its object id is its
 * actor id. That equality IS the same-actor rule, decided on ids alone — the
 * embedded `Person` is never read, and a bare-id object works the same way. An
 * `Update{Person}` naming a different actor is somebody describing someone else,
 * and is ignored (it falls through to the Note ingest, which drops a non-Note).
 */
const isSelfActorUpdate = (update: Update): boolean =>
  update.actorId != null && update.objectId?.href === update.actorId.href

/**
 * Inbound `Create` of a `Note`. Exported like the other `handleInbound*` entry
 * points so the inbox behaviour is testable without forging an HTTP signature.
 */
export const handleInboundCreate = (
  ctx: InboxContext<void>,
  create: Create,
  origin: string,
  onNewEntry?: (user: string) => void,
  enrich?: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>,
): Promise<void> => ingestFeedActivity(ctx, create, origin, onNewEntry, enrich)

/**
 * Inbound `Update`. Two meanings share the type: an actor editing **themselves**
 * refreshes our cached copies of their presentation (#1057); anything else is an
 * edited `Note` and re-runs the ingest, which upserts it in place — or, for an
 * author we don't follow, updates the boost cards of it.
 */
export const handleInboundUpdate = async (
  ctx: InboxContext<void>,
  update: Update,
  origin: string,
  onNewEntry?: (user: string) => void,
  enrich?: (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>,
): Promise<void> => {
  if (isSelfActorUpdate(update)) return await refreshRemoteActorPresentation(ctx, update)
  await ingestFeedActivity(ctx, update, origin, onNewEntry, enrich)
}

/**
 * Whether an inbound activity would store a new post for a read-only recipient and so is
 * dropped (still acknowledged): a Create or Update of a Note, or a boost of a third-party
 * post. A remote actor editing themselves and a boost of one of the recipient's own posts
 * only touch what is already there, so they go through.
 */
export const dropsForReadOnly = async (
  ctx: InboxContext<void>,
  activity: Create | Update | Announce,
  isReadOnly: (user: string) => Promise<boolean>,
): Promise<boolean> => {
  const me = ctx.recipient
  if (me == null || !isValidUsername(me)) return false
  if (activity instanceof Update && isSelfActorUpdate(activity)) return false
  if (activity instanceof Announce && ownTargetPostId(ctx, activity.objectId, me) != null) return false
  return await isReadOnly(me)
}

/**
 * Build a user's full `Person` actor document — shared by the actor dispatcher
 * and the profile-change `Update{Person}` delivery, so followers' servers
 * always receive exactly the representation the actor URL serves. The icon URL
 * carries the avatar's `updated_at` as a cache-busting `?v=`: remote servers
 * (Mastodon et al.) copy a remote avatar once and re-download it only when the
 * URL changes, so a changed avatar must change the URL.
 */
export const buildActorPerson = async (
  ctx: Context<void>,
  identifier: string,
  origin: string,
): Promise<Person | null> => {
  if (!isValidUsername(identifier)) return null
  let keys
  try {
    keys = await ctx.getActorKeyPairs(identifier)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
  if (keys.length === 0) return null
  // Advertise "locked account" when the user requires manual approval, so
  // Mastodon et al. show a follow *request* and hold the follow pending
  // (matching our own inbox behaviour of deferring the Accept).
  const settings = await getUserSettings(identifier)
  const avatarVersion = await getProfileAvatarVersion(identifier)
  const iconUrl = new URL(`${buildProfileUrl(origin, identifier)}/avatar.png`)
  if (avatarVersion) iconUrl.searchParams.set('v', String(avatarVersion.getTime()))
  return new Person({
    followers: ctx.getFollowersUri(identifier),
    following: ctx.getFollowingUri(identifier),
    icon: new Image({ url: iconUrl }),
    id: ctx.getActorUri(identifier),
    inbox: ctx.getInboxUri(identifier),
    manuallyApprovesFollowers: settings?.manually_approve_followers === true,
    name: settings?.display_name || undefined,
    outbox: ctx.getOutboxUri(identifier),
    preferredUsername: identifier,
    publicKey: keys[0].cryptographicKey,
    // The human-facing profile page. Mastodon-class clients link people
    // here instead of the actor document (whose content negotiation
    // answers 406 to a browser — see the HTML fallback router, #1047).
    url: new URL(buildProfileUrl(origin, identifier)),
  })
}

/**
 * Deliver an `Update{Person}` to the user's accepted followers after a profile
 * change (avatar upload/removal, display name). Without it, a follower's server never
 * refreshes its cached copy of the actor: Mastodon re-downloads an avatar only
 * on an incoming actor Update or a changed icon URL, and until now Aurboda
 * produced neither signal. Fire-and-forget at the call site — a delivery
 * failure must never fail the profile change itself.
 */
export const deliverActorUpdate = async (
  deps: { federation: Federation<void>; origin: string },
  user: string,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const person = await buildActorPerson(ctx, user, deps.origin)
  if (person?.id == null) return
  const update = new Update({
    actor: person.id,
    cc: ctx.getFollowersUri(user),
    // Mastodon-style per-change id fragment; profile updates are not
    // dereferenceable objects, so uniqueness is all the id needs.
    id: new URL(`${person.id.href}#updates/${Date.now()}`),
    object: person,
    to: new URL(AS_PUBLIC),
  })
  await ctx.sendActivity({ identifier: user }, 'followers', update)
}

/**
 * Tell the user's followers' servers that the actor is gone, so they drop the
 * follow and the cached profile. Needs the user's database (key pair, follower
 * list), so it runs before the database is dropped; delivery is synchronous
 * (no message queue), so nothing reads that database after this resolves.
 */
export const deliverActorDelete = async (
  deps: Pick<FeedDeliveryDeps, 'federation' | 'listRelayRecipients' | 'origin'>,
  user: string,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const actorId = ctx.getActorUri(user)
  const del = new Delete({
    actor: actorId,
    cc: ctx.getFollowersUri(user),
    id: new URL(`${actorId.href}#delete`),
    object: new Tombstone({ id: actorId }),
    to: new URL(AS_PUBLIC),
  })
  // Relays received the user's public posts, so they hear of the account's end too.
  const [followers] = await Promise.allSettled([
    ctx.sendActivity({ identifier: user }, 'followers', del),
    deliverToRelays(deps, ctx, user, del),
  ])
  if (followers.status === 'rejected') throw followers.reason
}

export const createFeedFederation = (
  origin: string,
  apiBaseUrl: string,
  /** Fire-and-forget: called with the recipient when a genuinely new post is ingested. */
  onNewTimelineEntry?: (user: string) => void,
  /**
   * Fire-and-forget: called with `(recipient, followeeActorUri)` when a follow WE
   * sent becomes accepted, to backfill the followee's recent public posts.
   */
  onFollowAccepted?: (user: string, actorUri: string) => void,
  /** Deployed software version (BUILD_SHA), reported in NodeInfo. */
  version = 'dev',
  /** Whether anyone can sign up (`signup_mode = 'open'`), reported as NodeInfo `openRegistrations` (#1050). */
  isSignupOpen: () => Promise<boolean> = async () => false,
  /** A deleted account's actor answers 410 Gone with a Tombstone instead of 404. */
  isDeletedUser: (username: string) => boolean = () => false,
  /** A read-only account (plan expired past the grace period) stores no new inbound posts. */
  isReadOnly: (username: string) => Promise<boolean> = async () => false,
  /** The instance actor and its relay subscriptions; without it the instance actor does not exist. */
  instance?: InstanceActorDeps,
): Federation<void> => {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    // Pin the canonical origin (the public base URL) so actor ids, WebFinger
    // self-links, inbox/outbox URIs, etc. are always built with the right
    // scheme + host — Mastodon requires https, and reconstructing the scheme
    // from the request yields http behind the TLS-terminating proxy.
    origin,
    // No message queue: `sendActivity` then delivers synchronously (awaits the
    // POST). An in-process queue would need `federation.startQueue()` to drain —
    // which the Express integration doesn't run — so queued activities (e.g. the
    // Create on share) would never send. A persistent Postgres queue + worker is
    // a later reliability slice; synchronous delivery is correct for now.
  })

  // Fetches native structured data (typed metrics + series) for ingested posts
  // that come from Aurboda instances, so the web can render a native chart.
  const enrich = createAurbodaEnricher(origin)

  // NodeInfo instance metadata (#1047). Fedify serves the `/.well-known/nodeinfo`
  // JRD automatically once a dispatcher is registered; peers and crawlers use it
  // to identify the software (some, like FitPub, gate follow-ability on it).
  // Usage statistics are deliberately absent/zero: the per-user-database
  // architecture has no cheap global user or post counts, and NodeInfo allows
  // omitting `users.total`.
  federation.setNodeInfoDispatcher('/nodeinfo/2.1', async () => ({
    openRegistrations: await isSignupOpen().catch(() => false),
    protocols: ['activitypub'],
    software: {
      name: 'aurboda',
      repository: new URL('https://github.com/fiddur/aurboda'),
      version,
    },
    usage: { localComments: 0, localPosts: 0, users: {} },
  }))

  const instanceUsername = instanceActorUsername(origin)
  // The stored pair never changes, so it is read and imported once; a failure is retried next time.
  let instanceKeyPairPromise: Promise<CryptoKeyPair> | null = null
  const instanceKeyPair = (): Promise<CryptoKeyPair> => {
    if (instance == null) throw new Error('No instance actor')
    instanceKeyPairPromise ??= instance
      .instanceKeys()
      .then((kp) => toCryptoKeyPair(kp.private_key_pem, kp.public_key_pem))
      .catch((error: unknown) => {
        instanceKeyPairPromise = null
        throw error
      })
    return instanceKeyPairPromise
  }
  federation
    .setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
      if (isInstanceActor(identifier)) {
        return instance == null
          ? null
          : buildInstanceActor(ctx, origin, await ctx.getActorKeyPairs(identifier))
      }
      return isDeletedUser(identifier)
        ? new Tombstone({ id: ctx.getActorUri(identifier) })
        : buildActorPerson(ctx, identifier, origin)
    })
    .mapActorAlias(INSTANCE_ACTOR_PATH, INSTANCE_ACTOR_ID)
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (isInstanceActor(identifier)) {
        if (instance == null) return []
        return [await instanceKeyPair()]
      }
      if (!isValidUsername(identifier) || isDeletedUser(identifier)) return []
      try {
        const kp = await getOrCreateActorKeyPair(identifier)
        return [await toCryptoKeyPair(kp.private_key_pem, kp.public_key_pem)]
      } catch (error) {
        if (isMissingDatabase(error)) return []
        throw error
      }
    })
    .mapHandle((_ctx, username) => {
      if (instance != null && username === instanceUsername) return INSTANCE_ACTOR_ID
      return isValidUsername(username) ? username : null
    })

  // Inbound inbox. Fedify verifies the HTTP Signature before invoking these
  // handlers, so a request that reaches `.on(...)` is authenticated as the
  // sending actor. Unregistered activity types are silently ignored.
  const inbox = federation.setInboxListeners('/users/{identifier}/inbox', '/inbox')
  // Fetches made on the shared inbox's behalf are signed as the instance actor.
  if (instance != null) inbox.setSharedKeyDispatcher(() => ({ identifier: INSTANCE_ACTOR_ID }))
  inbox
    .on(Follow, (ctx, follow) => handleInboundFollow(ctx, follow, instance?.relays))
    .on(Undo, async (ctx, undo) => {
      if (instance?.publicTagPosts != null && isInstanceDelivery(ctx)) {
        await handleInstanceActorUndo(ctx, undo, instance.publicTagPosts)
      }
      await handleInboundUndo(ctx, undo)
    })
    .on(Accept, async (ctx, accept) => {
      if (await handleRelayResponse(accept, instance?.relays)) return
      if (await handleTagFollowResponse(accept, instance?.tagFollows)) return
      // Accept of a Follow WE sent — the followee's server confirms the follow.
      // `accept.actorId` is the followee we followed, matching the `actor_uri` of
      // our pending row.
      const me = await localFollowerIdentifier(ctx, accept)
      if (me == null || accept.actorId == null) return
      try {
        await markFeedFollowingAccepted(me, accept.actorId.href)
      } catch (error) {
        if (isMissingDatabase(error)) return
        throw error
      }
      // The follow is now established → backfill the followee's recent public
      // posts so the timeline isn't empty until they next post. Fire-and-forget
      // (a slow/large outbox must never block inbox processing), and after the
      // accept is durably recorded. Covers remote *and* local follows: a local
      // followee's auto-Accept loops back through this same handler.
      onFollowAccepted?.(me, accept.actorId.href)
    })
    .on(Reject, async (ctx, reject) => {
      if (await handleRelayResponse(reject, instance?.relays)) return
      if (await handleTagFollowResponse(reject, instance?.tagFollows)) return
      // Reject of a Follow we sent — the followee declined; drop our pending row.
      const me = await localFollowerIdentifier(ctx, reject)
      if (me == null || reject.actorId == null) return
      try {
        await removeFeedFollowingByActor(me, reject.actorId.href)
      } catch (error) {
        if (isMissingDatabase(error)) return
        throw error
      }
    })
    // Create / Update of a Note from an actor we follow → ingest into our home
    // timeline. Update reuses the same upsert (keyed on the Note's object id), so
    // an edit replaces the stored copy. Accepted followees are ingested in full;
    // the only stranger Note admitted is a reply to one of the recipient's own
    // posts (see ingestFeedActivity). An Update of the SENDING ACTOR instead
    // refreshes our cached copies of their presentation (#1057).
    .on(Create, async (ctx, create) => {
      if (await dropsForReadOnly(ctx, create, isReadOnly)) return
      await handleInboundCreate(ctx, create, origin, onNewTimelineEntry, enrich)
    })
    .on(Update, async (ctx, update) => {
      if (await dropsForReadOnly(ctx, update, isReadOnly)) return
      await handleInboundUpdate(ctx, update, origin, onNewTimelineEntry, enrich)
    })
    .on(Like, handleInboundLike)
    .on(QuoteRequest, handleInboundQuoteRequest)
    .on(
      Announce,
      createAnnounceListener({
        isReadOnly,
        onUserAnnounce: (ctx, announce) =>
          handleInboundAnnounce(ctx, announce, origin, onNewTimelineEntry, enrich),
        publicTagPosts: instance?.publicTagPosts,
      }),
    )
    .on(Delete, async (ctx, del) => {
      if (instance?.publicTagPosts != null && isInstanceDelivery(ctx)) {
        return await handleInstanceActorDelete(ctx, del, instance.publicTagPosts)
      }
      await handleInboundDelete(ctx, del)
    })

  // Individual post object. Serves the same `Note` that was delivered, at its
  // canonical id, so a remote server can dereference it. Only `public`/`unlisted`
  // objects resolve — `followers`-only posts are delivered with the object
  // inline, so their id never needs to be fetched; refusing them keeps
  // follower-only content off an unauthenticated fetch.
  federation.setObjectDispatcher(
    Note,
    '/users/{identifier}/feed/{postId}',
    async (ctx, { identifier, postId }) => {
      if (!isValidUsername(identifier) || !UUID_RE.test(postId)) return null
      let post
      try {
        post = await getFeedPostById(identifier, postId)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
      if (post == null || !isPubliclyVisible(post.visibility)) return null
      // An article and an activity share this Note id (a post is one or the
      // other). An article's Note is built from its stored content — no activity.
      const article = toDeliverableArticle(post)
      if (article != null) return buildArticleNote(ctx, identifier, article, apiBaseUrl)
      const challenge = toDeliverableChallenge(post)
      if (challenge != null) return buildChallengeNote(ctx, identifier, challenge)
      const exercise = toDeliverableExercise(post)
      if (exercise != null) {
        return buildExerciseNote(ctx, identifier, exercise, await exerciseNoteContent(identifier, exercise))
      }
      const dashboard = toDeliverableDashboard(post)
      if (dashboard != null) {
        return buildDashboardNote(
          ctx,
          identifier,
          dashboard,
          await dashboardNoteContent(identifier, dashboard),
        )
      }
      const reply = toDeliverableReply(post)
      if (reply != null) return buildReplyNote(ctx, identifier, reply)
      if (post.activity_id == null) return null
      // Resolve the merged-span activity so the served Note matches what the user
      // shared (and what we delivered), not just the anchor sub-activity (#881).
      const activity = await resolveFeedActivity(identifier, post.activity_id)
      if (activity == null) return null
      return buildFeedNote(ctx, identifier, post, activity, apiBaseUrl)
    },
  )

  // A stamp resolves only while its post is public/unlisted, so unsharing or deleting
  // the post revokes every stamp on it.
  federation.setObjectDispatcher(
    QuoteAuthorization,
    '/users/{identifier}/stamps/{stampId}',
    async (ctx, { identifier, stampId }) => {
      if (!isValidUsername(identifier) || !UUID_RE.test(stampId)) return null
      const row = await loadValidStamp(identifier, stampId)
      if (row == null) return null
      return new QuoteAuthorization({
        attribution: ctx.getActorUri(identifier),
        id: ctx.getObjectUri(QuoteAuthorization, { identifier, stampId }),
        interactingObject: new URL(row.quote_uri),
        interactionTarget: ctx.getObjectUri(Note, { identifier, postId: row.post_id }),
      })
    },
  )

  // Outbox: the user's public + unlisted posts as `Create` activities, so a
  // Mastodon profile shows them. Cursor-paginated (`OUTBOX_PAGE_SIZE` per page)
  // so an unauthenticated fetch never resolves every post's scalars at once; the
  // cursor is a simple offset (a concurrent share can shift a page boundary —
  // acceptable for an occasionally-crawled outbox). A post whose activity was
  // soft-deleted is skipped from the items while `setCounter` still counts it;
  // the divergence self-heals when the stale post is removed.
  federation
    .setOutboxDispatcher('/users/{identifier}/outbox', async (ctx, identifier, cursor) => {
      if (isInstanceActor(identifier)) return instance == null ? null : { items: [] }
      if (!isValidUsername(identifier)) return null
      const offset = cursor == null ? 0 : Number.parseInt(cursor, 10)
      // `isSafeInteger` also rejects absurd offsets (e.g. a crafted `1e20`) that
      // would overflow Postgres `bigint` in `OFFSET` and 500 the request.
      if (!Number.isSafeInteger(offset) || offset < 0) return null
      let posts
      try {
        posts = await listPublicFeedPostsPage(identifier, OUTBOX_PAGE_SIZE, offset)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
      const items = (
        await Promise.all(
          posts.map(async (post) => {
            // Articles federate as `Create{Note}` built from their stored content
            // (no linked activity); every other post as `Create{Note}` from its
            // resolved activity.
            const article = toDeliverableArticle(post)
            if (article != null) return buildArticleNoteCreate(ctx, identifier, article, apiBaseUrl)
            const challenge = toDeliverableChallenge(post)
            if (challenge != null) return buildChallengeNoteCreate(ctx, identifier, challenge)
            const exercise = toDeliverableExercise(post)
            if (exercise != null) {
              const content = await exerciseNoteContent(identifier, exercise)
              return buildExerciseNoteCreate(ctx, identifier, exercise, content)
            }
            const dashboard = toDeliverableDashboard(post)
            if (dashboard != null) {
              const content = await dashboardNoteContent(identifier, dashboard)
              return buildDashboardNoteCreate(ctx, identifier, dashboard, content)
            }
            const reply = toDeliverableReply(post)
            if (reply != null) return buildReplyNoteCreate(ctx, identifier, reply)
            if (post.activity_id == null) return null
            const activity = await resolveFeedActivity(identifier, post.activity_id)
            return activity == null ? null : buildFeedCreate(ctx, identifier, post, activity, apiBaseUrl)
          }),
        )
      ).filter((item): item is Create => item != null)
      const nextCursor = posts.length === OUTBOX_PAGE_SIZE ? String(offset + OUTBOX_PAGE_SIZE) : null
      return { items, nextCursor }
    })
    .setCounter(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return 0
      try {
        return await countPublicFeedPosts(identifier)
      } catch (error) {
        if (isMissingDatabase(error)) return 0
        throw error
      }
    })
    .setFirstCursor((_ctx, identifier) => (isValidUsername(identifier) ? '0' : null))
    .setLastCursor(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return null
      try {
        const count = await countPublicFeedPosts(identifier)
        // Offset of the last page; '0' for an empty or single-page outbox.
        return count <= OUTBOX_PAGE_SIZE
          ? '0'
          : String(Math.floor((count - 1) / OUTBOX_PAGE_SIZE) * OUTBOX_PAGE_SIZE)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
    })

  // Real followers, backed by feed_follower. This both serves the followers
  // collection and enumerates recipients for `sendActivity(..., 'followers', …)`.
  federation
    .setFollowersDispatcher('/users/{identifier}/followers', async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return { items: [] }
      try {
        // Only *accepted* followers are published + delivered to (a pending
        // request isn't a confirmed follower and gets no `followers`-only posts).
        const followers = await listFeedFollowers(identifier, { accepted: true })
        return {
          items: followers.map((f) => ({
            endpoints: f.shared_inbox_uri ? { sharedInbox: new URL(f.shared_inbox_uri) } : null,
            id: new URL(f.actor_uri),
            inboxId: new URL(f.inbox_uri),
          })),
        }
      } catch (error) {
        if (isMissingDatabase(error)) return { items: [] }
        throw error
      }
    })
    .setCounter(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return 0
      try {
        return await countFeedFollowers(identifier)
      } catch (error) {
        if (isMissingDatabase(error)) return 0
        throw error
      }
    })

  // The actors this user follows, backed by feed_following. Only *accepted*
  // follows are published (a pending follow isn't a confirmed relationship yet).
  // Items are the followees' actor URIs.
  federation
    .setFollowingDispatcher('/users/{identifier}/following', async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return { items: [] }
      try {
        const following = await listAcceptedFeedFollowing(identifier)
        return { items: following.map((f) => new URL(f.actor_uri)) }
      } catch (error) {
        if (isMissingDatabase(error)) return { items: [] }
        throw error
      }
    })
    .setCounter(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return 0
      try {
        return await countAcceptedFeedFollowing(identifier)
      } catch (error) {
        if (isMissingDatabase(error)) return 0
        throw error
      }
    })

  return federation
}
