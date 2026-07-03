import type { FeedVisibility } from '@aurboda/api-spec'
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

import { resolveActivityScalars } from './feed-activity.ts'
import { addressingFor, feedPostContent } from './object.ts'

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
}

export interface DeliverablePost {
  id: string
  included_metrics: string[]
  visibility: FeedVisibility
  created_at: Date
  /** Last-edited time; makes each `Update` activity id unique (see `buildFeedUpdate`). */
  updated_at: Date
  /** Attach a rendered heart-rate chart image. */
  include_chart: boolean
  /** Attach a rendered GPS route-map image. */
  include_map: boolean
}

/**
 * Image attachments for a post's opted-in chart/route. Each points at the public
 * on-demand image endpoint (`/api/public/<user>/feed/<id>/{chart,route}.png`),
 * built against the actor's origin so it matches the deployed API base. Fedify's
 * `Image` carries `url` + `mediaType` + intrinsic size so Mastodon lays it out.
 */
const imageAttachments = (actorUri: URL, user: string, post: DeliverablePost): Image[] => {
  const base = new URL(`/api/public/${encodeURIComponent(user)}/feed/${post.id}`, actorUri)
  const images: Image[] = []
  if (post.include_chart) {
    images.push(
      new Image({
        height: 420,
        mediaType: 'image/png',
        name: 'Heart rate',
        url: new URL(`${base.href}/chart.png`),
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
        url: new URL(`${base.href}/route.png`),
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
 * `published` is intentionally omitted: Fedify's vocab types it as the ambient
 * (esnext.temporal) `Temporal.Instant`, which the `@js-temporal` polyfill value
 * isn't assignable to. Delivery fires right after the share, so remote servers
 * timestamp it at receipt (≈ share time); wiring an explicit `published` is a
 * follow-up (needs Temporal-lib interop sorted).
 */
export const buildFeedNote = async (
  ctx: Context<void>,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
): Promise<Note> => {
  const scalars = await resolveActivityScalars(user, activity, post.included_metrics)
  const { content, name } = feedPostContent(activity.title, activity.activity_type, scalars)
  const actorUri = ctx.getActorUri(user)
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Note({
    attachments: imageAttachments(actorUri, user, post),
    attribution: actorUri,
    ccs: cc,
    content,
    id: noteId,
    name,
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
): Promise<Create> => {
  const note = await buildFeedNote(ctx, user, post, activity)
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: note,
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
): Promise<Update> => {
  const note = await buildFeedNote(ctx, user, post, activity)
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
  const create = await buildFeedCreate(ctx, user, post, activity)
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
  const update = await buildFeedUpdate(ctx, user, post, activity)
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
