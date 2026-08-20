import type { ArticleContent, ChallengeShare, FeedVisibility } from '@aurboda/api-spec'
/**
 * Build and deliver a shared feed post over ActivityPub.
 *
 * The Mastodon-compatible representation is a Fedify `Create{Note}` — an HTML
 * `content` summary + `name`/`url`, addressed per the post's visibility. The
 * `Note`'s id is its object-dispatcher URL (`getObjectUri(Note, …)`), so the
 * object we deliver, the one listed in the outbox, and the one served when a
 * remote server dereferences that id are all built here and stay identical.
 *
 * `deliverFeedPost` fans the `Create` out via `ctx.sendActivity(..., 'followers',
 * …)`, which Fedify signs and dedupes by shared inbox. Delivery is synchronous
 * (no message queue configured), so it awaits the outbound POSTs; retry/
 * durability via a persistent queue is a later slice.
 *
 * The custom `aurboda:` structured extension is not carried on the Fedify `Note`
 * (its typed vocab drops unknown properties); that richer, Aurboda-native
 * representation lives in `object.ts` for a future content-negotiated endpoint.
 * Delivery is best-effort: callers invoke it fire-and-forget.
 */
import type { Context, Federation } from '@fedify/fedify'

import { Create, Delete, Image, Note, Tombstone, Update } from '@fedify/fedify/vocab'

import type { FeedPostRecord } from '../../db/index.ts'

import { getSettings } from '../settings.ts'
import { articleImageAttachments, renderArticleContentHtml } from './article-object.ts'
import { renderChallengeShareHtml } from './challenge-object.ts'
import { resolveActivityScalars } from './feed-activity.ts'
import { addressingFor, feedPostContent, formatActivityWindow, isPubliclyVisible } from './object.ts'
import { dateToTemporalInstant } from './temporal-interop.ts'

/**
 * AS2 `to`/`cc` addressing (as URLs) for a post's visibility — the same table
 * `addressingFor` uses for the JSON object model, mapped through `URL` so the
 * two can't drift.
 */
export const recipients = (visibility: FeedVisibility, followers: URL): { to: URL[]; cc: URL[] } => {
  const { cc, to } = addressingFor(visibility, followers.href)
  return { cc: cc.map((u) => new URL(u)), to: to.map((u) => new URL(u)) }
}

export interface FeedDeliveryDeps {
  federation: Federation<void>
  /** Canonical web origin, e.g. `https://aurboda.net`. */
  origin: string
  /** Public API base, e.g. `https://aurboda.net/api` — image attachment URLs hang off this. */
  apiBaseUrl: string
}

export interface DeliverablePost {
  id: string
  included_metrics: string[]
  visibility: FeedVisibility
  /** The author's personal message (plain text); null/undefined = none shared. */
  message?: string | null
  created_at: Date
  /** Last-edited time; makes each `Update` activity id unique (see `buildFeedUpdate`). */
  updated_at: Date
  /** Attach a rendered heart-rate chart image. */
  include_chart: boolean
  /** Attach a rendered GPS route-map image. */
  include_map: boolean
  /** Capability token appended to `followers`-only image URLs (see `imageAttachments`). */
  image_token: string
}

/**
 * Image attachments for a post's opted-in chart/route. Each points at the public
 * on-demand image endpoint (`/api/public/<user>/feed/<id>/{chart,route}.png`),
 * built against the actor's origin so it matches the deployed API base. Fedify's
 * `Image` carries `url` + `mediaType` + intrinsic size so Mastodon lays it out.
 *
 * `public`/`unlisted` images are served unauthenticated. A `followers`-only
 * post's URLs instead carry the post's unguessable **capability token**
 * (`?token=…`): the fediverse fetches media without HTTP signatures, so the
 * endpoint can't verify a signed request — the token is what lets a follower's
 * server fetch the image while an untoken'd guess 404s. The token is only ever
 * embedded in the Note delivered to followers, never in the public object/outbox.
 */
export const imageAttachments = (apiBaseUrl: string, user: string, post: DeliverablePost): Image[] => {
  // Same base as the series links (feed-activity.ts) — the configured API base,
  // NOT a hardcoded `<origin>/api`, so it stays correct if the two ever diverge.
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(user)}/feed/${post.id}`
  const query = isPubliclyVisible(post.visibility) ? '' : `?token=${encodeURIComponent(post.image_token)}`
  const images: Image[] = []
  if (post.include_chart) {
    images.push(
      new Image({
        height: 420,
        mediaType: 'image/png',
        name: 'Heart rate',
        url: new URL(`${base}/chart.png${query}`),
        width: 1000,
      }),
    )
  }
  if (post.include_map) {
    images.push(
      new Image({
        height: 700,
        mediaType: 'image/png',
        name: 'Route',
        url: new URL(`${base}/route.png${query}`),
        width: 700,
      }),
    )
  }
  return images
}

export interface DeliverableActivity {
  activity_type: string
  start_time: Date
  end_time?: Date
  title?: string
}

/**
 * Build the Fedify `Note` for a shared post: the Mastodon-compatible object
 * (HTML `content` + headline `name`), addressed per visibility. Its id and `url`
 * are the object-dispatcher URL (`getObjectUri(Note, …)`), so the delivered
 * object and the one served at that URL are guaranteed identical.
 *
 * `published` is the post's `created_at` (its share time), so remote servers
 * order and timestamp it correctly instead of stamping it at receipt. Fedify
 * types `published` as the ambient `Temporal.Instant`; `dateToTemporalInstant`
 * bridges our `@js-temporal/polyfill` value to it.
 */
export const buildFeedNote = async (
  ctx: Context<void>,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
  apiBaseUrl: string,
): Promise<Note> => {
  const scalars = await resolveActivityScalars(user, activity, post.included_metrics)
  // The activity-date line renders in the author's device timezone (like the
  // article block images); unknown/invalid falls back to UTC inside the formatter.
  const settings = await getSettings(user).catch(() => null)
  const { content, name } = feedPostContent(activity.title, activity.activity_type, scalars, {
    message: post.message ?? undefined,
    windowLabel: formatActivityWindow(
      activity.start_time,
      activity.end_time,
      settings?.device_timezone ?? undefined,
    ),
  })
  const actorUri = ctx.getActorUri(user)
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Note({
    attachments: imageAttachments(apiBaseUrl, user, post),
    attribution: actorUri,
    ccs: cc,
    content,
    id: noteId,
    name,
    published: dateToTemporalInstant(post.created_at),
    tos: to,
    url: noteId,
  })
}

/**
 * Wrap the post's `Note` in the `Create` activity that is both delivered to
 * followers and listed in the actor's outbox. The `Create` id is a `#create`
 * fragment on the Note id, so it never collides with (nor 404s separately from)
 * the object URL.
 */
export const buildFeedCreate = async (
  ctx: Context<void>,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
  apiBaseUrl: string,
): Promise<Create> => {
  const note = await buildFeedNote(ctx, user, post, activity, apiBaseUrl)
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: note,
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
}

/**
 * Wrap the post's (re-resolved) `Note` in an `Update` activity. Sent when a
 * post's shared metric selection or visibility changes, so followers' servers
 * replace the stored object. The `Update` id carries the post's `updated_at`
 * (`#update-<epoch-ms>`) so each edit has a distinct activity id — AS2 requires
 * unique activity ids, and servers that dedupe inbound activities by id would
 * otherwise drop every edit after the first.
 */
export const buildFeedUpdate = async (
  ctx: Context<void>,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
  apiBaseUrl: string,
): Promise<Update> => {
  const note = await buildFeedNote(ctx, user, post, activity, apiBaseUrl)
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: note,
    tos: to,
  })
}

/**
 * Build the `Delete{Tombstone}` for a removed post — the AS2-standard way to
 * retract it from followers' timelines. Needs no activity/scalar resolution
 * (just the object id + addressing), so it stays synchronous and survives the
 * post row already being gone.
 */
export const buildFeedDelete = (ctx: Context<void>, user: string, post: DeliverablePost): Delete => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Delete({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#delete`),
    object: new Tombstone({ id: noteId }),
    tos: to,
  })
}

/** Build and send the `Create{Note}` for a freshly-shared post to its followers. */
export const deliverFeedPost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const create = await buildFeedCreate(ctx, user, post, activity, deps.apiBaseUrl)
  await ctx.sendActivity({ identifier: user }, 'followers', create)
}

/** Build and send the `Update{Note}` for an edited post to its followers. */
export const deliverFeedUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const update = await buildFeedUpdate(ctx, user, post, activity, deps.apiBaseUrl)
  await ctx.sendActivity({ identifier: user }, 'followers', update)
}

/** Build and send the `Delete{Tombstone}` for a removed post to its followers. */
export const deliverFeedDelete = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverablePost,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const del = buildFeedDelete(ctx, user, post)
  await ctx.sendActivity({ identifier: user }, 'followers', del)
}

// ---------------------------------------------------------------------------
// Articles (long-form posts). An article federates as a `Note` — Mastodon
// discards `content` for AS2 `Article` (a converted type) and renders only
// name + url, so a Note is what actually shows the prose + attached images. The
// article's Note is served on the SAME object path as an activity's Note (they
// never collide — a post is one or the other), so a deleted article tombstones
// there like any post. Aurboda peers get the richer inline render via structured
// enrichment (a later slice), not the AS2 object type. No activity to resolve.
// ---------------------------------------------------------------------------

/** The delivery-facing view of an article post (its `article` guaranteed present). */
export interface DeliverableArticle {
  id: string
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
  image_token: string
  article: ArticleContent
}

/** Narrow a stored feed post to a `DeliverableArticle`, or null when it isn't an article. */
export const toDeliverableArticle = (post: FeedPostRecord): DeliverableArticle | null =>
  post.kind === 'article' && post.article != null
    ? {
        article: post.article,
        created_at: post.created_at,
        id: post.id,
        image_token: post.image_token,
        updated_at: post.updated_at,
        visibility: post.visibility,
      }
    : null

/**
 * Build the Fedify `Note` for an article: the Mastodon-compatible object (title
 * `name` + prose HTML `content` + chart/correlation PNG attachments), at the
 * post's canonical Note id, addressed per visibility. Synchronous — an article
 * carries no activity to resolve. A deleted article tombstones at this same id.
 */
export const buildArticleNote = (
  ctx: Context<void>,
  user: string,
  post: DeliverableArticle,
  apiBaseUrl: string,
): Note => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Note({
    attachments: articleImageAttachments(
      apiBaseUrl,
      user,
      post.id,
      post.visibility,
      post.image_token,
      post.updated_at,
      post.article,
    ),
    attribution: ctx.getActorUri(user),
    ccs: cc,
    content: renderArticleContentHtml(post.article),
    id: noteId,
    name: post.article.title,
    published: dateToTemporalInstant(post.created_at),
    tos: to,
    url: noteId,
  })
}

/** Wrap the article's Note in the `Create` delivered to followers and listed in the outbox. */
export const buildArticleNoteCreate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableArticle,
  apiBaseUrl: string,
): Create => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: buildArticleNote(ctx, user, post, apiBaseUrl),
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
}

/** Wrap the (re-resolved) article Note in an `Update`; id carries `updated_at` so each edit is distinct. */
export const buildArticleNoteUpdate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableArticle,
  apiBaseUrl: string,
): Update => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: buildArticleNote(ctx, user, post, apiBaseUrl),
    tos: to,
  })
}

/** Build and send the `Create{Note}` for a freshly-published article to its followers. */
export const deliverFeedArticlePost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableArticle,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  await ctx.sendActivity(
    { identifier: user },
    'followers',
    buildArticleNoteCreate(ctx, user, post, deps.apiBaseUrl),
  )
}

/** Build and send the `Update{Note}` for an edited article to its followers. */
export const deliverFeedArticleUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableArticle,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  await ctx.sendActivity(
    { identifier: user },
    'followers',
    buildArticleNoteUpdate(ctx, user, post, deps.apiBaseUrl),
  )
}

// ---------------------------------------------------------------------------
// Challenge shares (#994). A challenge invitation federates as a `Note` (like
// an article): the user's markdown note + the challenge's canonical public
// URL. Mastodon renders the link with the challenge page's existing OG preview
// card. Served on the SAME object path as every post kind, so it tombstones
// like any post. No activity to resolve and no attachments in phase 1.
// ---------------------------------------------------------------------------

/** The delivery-facing view of a challenge post (its `challenge` guaranteed present). */
export interface DeliverableChallenge {
  id: string
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
  challenge: ChallengeShare
  message: string | null
}

/** Narrow a stored feed post to a `DeliverableChallenge`, or null when it isn't one. */
export const toDeliverableChallenge = (post: FeedPostRecord): DeliverableChallenge | null =>
  post.kind === 'challenge' && post.challenge != null
    ? {
        challenge: post.challenge,
        created_at: post.created_at,
        id: post.id,
        message: post.message,
        updated_at: post.updated_at,
        visibility: post.visibility,
      }
    : null

/**
 * Build the Fedify `Note` for a challenge share: name heading + sanitised
 * markdown note + canonical link as `content`, addressed per visibility, at the
 * post's canonical Note id. Synchronous — nothing to resolve.
 */
export const buildChallengeNote = (ctx: Context<void>, user: string, post: DeliverableChallenge): Note => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Note({
    attribution: ctx.getActorUri(user),
    ccs: cc,
    content: renderChallengeShareHtml(post.challenge, post.message),
    id: noteId,
    name: post.challenge.name,
    published: dateToTemporalInstant(post.created_at),
    tos: to,
    url: noteId,
  })
}

/** Wrap the challenge Note in the `Create` delivered to followers and listed in the outbox. */
export const buildChallengeNoteCreate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableChallenge,
): Create => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: buildChallengeNote(ctx, user, post),
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
}

/** Wrap the challenge Note in an `Update`; id carries `updated_at` so each edit is distinct. */
export const buildChallengeNoteUpdate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableChallenge,
): Update => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: buildChallengeNote(ctx, user, post),
    tos: to,
  })
}

/** Build and send the `Create{Note}` for a freshly-shared challenge to followers. */
export const deliverFeedChallengePost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableChallenge,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  await ctx.sendActivity({ identifier: user }, 'followers', buildChallengeNoteCreate(ctx, user, post))
}

/** Build and send the `Update{Note}` for an edited challenge share to followers. */
export const deliverFeedChallengeUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableChallenge,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  await ctx.sendActivity({ identifier: user }, 'followers', buildChallengeNoteUpdate(ctx, user, post))
}
