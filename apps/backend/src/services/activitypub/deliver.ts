import type {
  ArticleContent,
  ChallengeShare,
  DashboardShare,
  ExerciseShare,
  FeedPostKind,
  FeedVisibility,
} from '@aurboda/api-spec'
/**
 * The Mastodon-compatible representation is a Fedify `Create{Note}` — an HTML
 * `content` summary + `name`/`url`, addressed per the post's visibility. The
 * `Note`'s id is its object-dispatcher URL (`getObjectUri(Note, …)`), so the
 * object we deliver, the one listed in the outbox, and the one served when a
 * remote server dereferences that id are all built here and stay identical.
 *
 * `deliverFeedPost` fans the `Create` out via `ctx.sendActivity(..., 'followers',
 * …)`, which Fedify signs and dedupes by shared inbox. Delivery is synchronous
 * (no message queue configured), so it awaits the outbound POSTs.
 *
 * Every activity Note also carries the QuantPub `quant:` extension (#896):
 * Fedify's typed vocab drops unknown properties, so `withQuantJsonLd` splices
 * the typed fields into the serialized JSON-LD of the outermost object we hand
 * to Fedify — the `Create`/`Update` for delivery and the outbox, the bare
 * `Note` for the object dispatcher (see `quant-extension.ts`). The AS2 window
 * (`startTime`/`endTime`) is set natively on the Note.
 * Delivery is best-effort: callers invoke it fire-and-forget.
 */
import type { Context, Federation } from '@fedify/fedify'

import {
  type Activity,
  Create,
  Delete,
  Image,
  InteractionPolicy,
  InteractionRule,
  isActor,
  Mention,
  Note,
  PUBLIC_COLLECTION,
  QuoteAuthorization,
  Tombstone,
  Update,
} from '@fedify/fedify/vocab'

import type { FeedPostRecord, FeedQuoteAuthorizationRecord } from '../../db/index.ts'

import { deleteFeedQuoteAuthorizationsForPost, hasLocations, hasTimeSeries } from '../../db/index.ts'
import { articleBlockFigureUrl } from '../article.ts'
import { challengeWinners } from '../challenge-results.ts'
import { CHART_HEIGHT, CHART_WIDTH } from '../charts/chart-svg.ts'
import { formatExerciseLine, resolvePostExercises, toStructuredExercise } from '../feed-exercises.ts'
import { resolveStandingsChart } from '../feed-structured-challenge.ts'
import { resolveExerciseTrendSeries } from '../feed-structured-exercise.ts'
import { getSettings } from '../settings.ts'
import { type ArticleFigure, articleFigureName, renderArticleNote } from './article-object.ts'
import { identityToActorUri, identityToHandle, renderChallengeShareHtml } from './challenge-object.ts'
import { dashboardNoteContent } from './dashboard-object.ts'
import { exerciseNoteContent } from './exercise-object.ts'
import { resolveActivityScalars } from './feed-activity.ts'
import { type HashtagLinks, hashtagLinks, hashtagObjects, linkifyHashtags } from './hashtag-html.ts'
import { addressingFor, feedPostContent, formatActivityWindow, isPubliclyVisible } from './object.ts'
import { quantExerciseExtension, withQuantJsonLd } from './quant-extension.ts'
import { type ReplyContentSource, renderReplyContent, replyMentionName } from './reply-object.ts'
import { signedFetchOptions } from './signed-lookup.ts'
import { dateToTemporalInstant } from './temporal-interop.ts'

/** A Note's hashtag links: each tag points at the author's profile on this instance, filtered by it. */
const noteHashtags = (ctx: Context<void>, user: string, tags: readonly string[] | undefined): HashtagLinks =>
  hashtagLinks(ctx.canonicalOrigin, user, tags)

/**
 * AS2 `to`/`cc` addressing (as URLs) for a post's visibility — the same table
 * `addressingFor` uses for the JSON object model, mapped through `URL` so the
 * two can't drift.
 */
export const recipients = (visibility: FeedVisibility, followers: URL): { to: URL[]; cc: URL[] } => {
  const { cc, to } = addressingFor(visibility, followers.href)
  return { cc: cc.map((u) => new URL(u)), to: to.map((u) => new URL(u)) }
}

/**
 * FEP-044f quote policy for a Note. Mastodon reads a missing policy as "nobody
 * may quote", so every Note declares one: anyone for public/unlisted posts, only
 * the author (Mastodon's own form of "just me") for followers-only ones.
 */
export const quoteInteractionPolicy = (visibility: FeedVisibility, actorUri: URL): InteractionPolicy =>
  new InteractionPolicy({
    canQuote: new InteractionRule({
      automaticApprovals: [isPubliclyVisible(visibility) ? PUBLIC_COLLECTION : actorUri],
    }),
  })

export interface FeedDeliveryDeps {
  federation: Federation<void>
  /** Canonical web origin, e.g. `https://aurboda.net`. */
  origin: string
  /** Public API base, e.g. `https://aurboda.net/api` — image attachment URLs hang off this. */
  apiBaseUrl: string
  listRelayRecipients?: () => Promise<RelayRecipient[]>
  /** Records this server's public posts on the public tag pages (`services/public-tags.ts`). */
  publicTagPosts?: LocalPublicTagPosts
}

/** This server's own public posts on the public tag pages: recorded on delivery, dropped on Delete. */
export interface LocalPublicTagPosts {
  record: (user: string, note: Note, ctx: Context<void>) => Promise<void>
  remove: (user: string, objectUri: string) => Promise<void>
}

export interface RelayRecipient {
  id: URL
  inboxId: URL
}

export interface DeliverablePost {
  id: string
  /** The shared activity's anchor id; the exercises resolve over its merged view. */
  activity_id?: string | null
  included_metrics: string[]
  /** Metric keys whose series were explicitly shared (drive `quant:series` links). */
  series_metrics: string[]
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
  /** Share the session's exercises (sets, e1RM, volume, records). */
  include_exercises: boolean
  /** Capability token appended to `followers`-only image URLs (see `imageAttachments`). */
  image_token: string
  tags?: readonly string[]
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
 *
 * Only images with data behind them are attached (`available`): a remote server
 * that fails to fetch one drops the attachment for good. Each URL carries the
 * post's version (`v=updated_at`), since Mastodon re-downloads an attachment on
 * an Update only when its URL changed; the endpoint itself ignores `v`.
 */
export const imageAttachments = (
  apiBaseUrl: string,
  user: string,
  post: DeliverablePost,
  available: ImageAvailability,
): Image[] => {
  // Same base as the series links (feed-activity.ts) — the configured API base,
  // NOT a hardcoded `<origin>/api`, so it stays correct if the two ever diverge.
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(user)}/feed/${post.id}`
  const params = new URLSearchParams()
  if (!isPubliclyVisible(post.visibility)) params.set('token', post.image_token)
  params.set('v', String(post.updated_at.getTime()))
  const query = `?${params.toString()}`
  const images: Image[] = []
  if (post.include_chart && available.chart) {
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
  if (post.include_map && available.map) {
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
  data?: Record<string, unknown>
}

export interface ImageAvailability {
  chart: boolean
  map: boolean
}

export interface ImageDataLookups {
  hasSeries: (user: string, metric: string, start: Date, end: Date) => Promise<boolean>
  hasRoute: (user: string, start: Date, end: Date) => Promise<boolean>
}

/** Which opted-in images would render: the same window and data the image endpoints use. */
export const imageAvailability = async (
  user: string,
  post: Pick<DeliverablePost, 'include_chart' | 'include_map'>,
  activity: DeliverableActivity,
  lookups: ImageDataLookups,
): Promise<ImageAvailability> => {
  const end = activity.end_time
  if (end == null) return { chart: false, map: false }
  const [chart, map] = await Promise.all([
    post.include_chart ? lookups.hasSeries(user, 'heart_rate', activity.start_time, end) : false,
    post.include_map ? lookups.hasRoute(user, activity.start_time, end) : false,
  ])
  return { chart, map }
}

const dbImageLookups: ImageDataLookups = { hasRoute: hasLocations, hasSeries: hasTimeSeries }

/**
 * Build the Fedify `Note` for a shared post: the Mastodon-compatible object
 * (HTML `content` + headline `name`), addressed per visibility. Its id and `url`
 * are the object-dispatcher URL (`getObjectUri(Note, …)`), so the delivered
 * object and the one served at that URL are guaranteed identical.
 *
 * `published` is the post's `created_at` (its share time), so remote servers
 * order and timestamp it correctly instead of stamping it at receipt.
 */
const buildFeedNoteParts = async (
  ctx: Context<void>,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
  apiBaseUrl: string,
): Promise<{ note: Note; quant: Record<string, unknown> }> => {
  const scalars = await resolveActivityScalars(user, activity, post.included_metrics)
  const exercises = await resolvePostExercises(user, post, activity.activity_type)
  // The activity-date line renders in the author's device timezone (like the
  // article block images); unknown/invalid falls back to UTC inside the formatter.
  const settings = await getSettings(user).catch(() => null)
  const { content, name } = feedPostContent(activity.title, activity.activity_type, scalars, {
    exerciseLines: exercises.map(formatExerciseLine),
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
  const available = await imageAvailability(user, post, activity, dbImageLookups)
  const hashtags = noteHashtags(ctx, user, post.tags)
  const note = new Note({
    attachments: imageAttachments(apiBaseUrl, user, post, available),
    attribution: actorUri,
    ccs: cc,
    content: linkifyHashtags(content, hashtags),
    // The AS2 activity window — the workout time; `published` stays the share time.
    endTime: activity.end_time === undefined ? null : dateToTemporalInstant(activity.end_time),
    id: noteId,
    interactionPolicy: quoteInteractionPolicy(post.visibility, actorUri),
    name,
    published: dateToTemporalInstant(post.created_at),
    startTime: dateToTemporalInstant(activity.start_time),
    tags: hashtagObjects(hashtags),
    tos: to,
    // Mastodon applies an Update's content and attachments only when the object
    // says it was edited after the stored copy; without `updated` it re-reads polls only.
    updated: dateToTemporalInstant(post.updated_at),
    url: noteId,
  })
  const quant = quantExerciseExtension({
    activityType: activity.activity_type,
    apiBaseUrl,
    endTime: activity.end_time,
    exercises: exercises.map(toStructuredExercise),
    imageToken: post.image_token,
    postId: post.id,
    scalars,
    seriesMetrics: post.series_metrics,
    startTime: activity.start_time,
    user,
    visibility: post.visibility,
  })
  return { note, quant }
}

export const buildFeedNote = async (
  ctx: Context<void>,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
  apiBaseUrl: string,
): Promise<Note> => {
  const { note, quant } = await buildFeedNoteParts(ctx, user, post, activity, apiBaseUrl)
  // The dispatcher serves the Note bare, so the Note itself carries the extension.
  return withQuantJsonLd(note, quant)
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
  // The Create is the outermost serialized object, so IT carries the quant
  // extension (spliced into its embedded object) — wrapping the embedded Note
  // instead would be mangled by the activity-level JSON-LD compaction.
  const { note, quant } = await buildFeedNoteParts(ctx, user, post, activity, apiBaseUrl)
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  const create = new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: note,
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
  return withQuantJsonLd(create, quant)
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
  const { note, quant } = await buildFeedNoteParts(ctx, user, post, activity, apiBaseUrl)
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  const update = new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: note,
    tos: to,
  })
  return withQuantJsonLd(update, quant)
}

/**
 * Build the `Delete{Tombstone}` for a removed post — the AS2-standard way to
 * retract it from followers' timelines. Needs no activity/scalar resolution
 * (just the object id + addressing), so it stays synchronous and survives the
 * post row already being gone.
 */
export const buildFeedDelete = (
  ctx: Context<void>,
  user: string,
  post: Pick<DeliverablePost, 'id' | 'visibility'>,
): Delete => {
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

export const deliverFeedPost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const create = await buildFeedCreate(ctx, user, post, activity, deps.apiBaseUrl)
  await fanOut(deps, ctx, user, create, { relayActivity: relayCreate(post, create) })
}

export const deliverFeedUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const update = await buildFeedUpdate(ctx, user, post, activity, deps.apiBaseUrl)
  await fanOut(deps, ctx, user, update, { relayActivity: relayEdit(ctx, user, post, update) })
}

export const deliverFeedDelete = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverablePost & {
    kind?: FeedPostKind
    challenge?: ChallengeShare | null
    in_reply_to_actor_uri?: string | null
    in_reply_to_handle?: string | null
  },
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const del = buildFeedDelete(ctx, user, post)
  // A completion post was also delivered to each tagged winner's inbox, and a
  // reply to the inbox of the author it answered (neither need follow us), so
  // the Delete goes there too (#1074) — and, like Create/Update, independently
  // of the followers fan-out (#1079).
  await fanOut(deps, ctx, user, del, {
    mentions: [
      ...(post.challenge == null ? [] : challengeMentions(post.challenge)),
      ...replyMentions({
        in_reply_to_actor_uri: post.in_reply_to_actor_uri ?? null,
        in_reply_to_handle: post.in_reply_to_handle ?? null,
      }),
    ],
    // Whatever its visibility now: it may have been public once, and a relay
    // ignores the Delete of an id it never saw.
    relayActivity: post.kind === 'reply' ? null : del,
  })
}

/**
 * FEP-044f revocation of one of our stamps: a `Delete` of the `QuoteAuthorization` id, addressed to
 * the actor whose quote it approved and to our followers, as Mastodon's own revocation is, so every
 * server that verified the quote drops the approval, not only the quoting one.
 */
export const buildQuoteStampDelete = (
  ctx: Context<void>,
  user: string,
  stamp: Pick<FeedQuoteAuthorizationRecord, 'actor_uri' | 'id'>,
): Delete => {
  const stampUri = ctx.getObjectUri(QuoteAuthorization, { identifier: user, stampId: stamp.id })
  return new Delete({
    actor: ctx.getActorUri(user),
    ccs: [ctx.getFollowersUri(user)],
    id: new URL(`${stampUri.href}#delete`),
    object: stampUri,
    tos: [new URL(stamp.actor_uri)],
  })
}

/**
 * Sends each stamp's `Delete` to its quoting actor and to our followers; best-effort, so it never
 * throws for a failed send.
 */
export const deliverQuoteStampDeletes = async (
  deps: Pick<FeedDeliveryDeps, 'federation' | 'origin'>,
  user: string,
  stamps: readonly Pick<FeedQuoteAuthorizationRecord, 'actor_uri' | 'id'>[],
): Promise<void> => {
  if (stamps.length === 0) return
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  await Promise.all(
    stamps.map(async (stamp) => {
      const del = buildQuoteStampDelete(ctx, user, stamp)
      await Promise.all([
        deliverToMentioned(ctx, user, [{ actorUri: new URL(stamp.actor_uri), handle: stamp.actor_uri }], del),
        ctx.sendActivity({ identifier: user }, 'followers', del).catch((error: unknown) => {
          console.warn(`⚠️ Quote stamp Delete to ${user}'s followers failed:`, error)
        }),
      ])
    }),
  )
}

/**
 * A post that is no longer public or unlisted loses its stamps: the approvals are dropped and each
 * quoting actor gets the stamp's `Delete`. A public or unlisted post is left alone.
 */
export const revokeQuoteStamps = async (
  deps: Pick<FeedDeliveryDeps, 'federation' | 'origin'>,
  user: string,
  post: Pick<FeedPostRecord, 'id' | 'visibility'>,
): Promise<void> => {
  if (isPubliclyVisible(post.visibility)) return
  await deliverQuoteStampDeletes(deps, user, await deleteFeedQuoteAuthorizationsForPost(user, post.id))
}

// Articles (long-form posts). An article federates as a `Note` — Mastodon
// discards `content` for AS2 `Article` (a converted type) and renders only
// name + url, so a Note is what actually shows the prose + attached images. The
// article's Note is served on the SAME object path as an activity's Note (they
// never collide — a post is one or the other), so a deleted article tombstones
// there like any post. Aurboda peers get the richer inline render via structured
// enrichment (a later slice), not the AS2 object type. No activity to resolve.

/** The delivery-facing view of an article post (its `article` guaranteed present). */
export interface DeliverableArticle {
  id: string
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
  image_token: string
  article: ArticleContent
  tags?: readonly string[]
}

export const toDeliverableArticle = (post: FeedPostRecord): DeliverableArticle | null =>
  post.kind === 'article' && post.article != null
    ? {
        article: post.article,
        created_at: post.created_at,
        id: post.id,
        image_token: post.image_token,
        tags: post.tags,
        updated_at: post.updated_at,
        visibility: post.visibility,
      }
    : null

/**
 * One article figure as an attachment. A block figure's URL carries `v` (the
 * post's last-edited epoch): Mastodon re-hosts attachments at receipt, so the URL
 * itself must change for an `Update` to show the new chart.
 */
const articleFigureImage = (figure: ArticleFigure): Image =>
  new Image({
    height: figure.height,
    mediaType: figure.media_type,
    name: articleFigureName(figure),
    url: new URL(figure.url),
    width: figure.width,
  })

/**
 * Build the Fedify `Note` for an article: the Mastodon-compatible object (title
 * `name` + prose HTML `content` + numbered figure attachments), at the
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
  const hashtags = noteHashtags(ctx, user, post.tags)
  const { content, figures } = renderArticleNote(post.article, (index) =>
    articleBlockFigureUrl(
      apiBaseUrl,
      user,
      post.id,
      post.visibility,
      post.image_token,
      post.updated_at,
      index,
    ),
  )
  return new Note({
    attachments: figures.map(articleFigureImage),
    attribution: ctx.getActorUri(user),
    ccs: cc,
    content: linkifyHashtags(content, hashtags),
    id: noteId,
    interactionPolicy: quoteInteractionPolicy(post.visibility, ctx.getActorUri(user)),
    name: post.article.title,
    published: dateToTemporalInstant(post.created_at),
    tags: hashtagObjects(hashtags),
    tos: to,
    updated: dateToTemporalInstant(post.updated_at),
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

export const deliverFeedArticlePost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableArticle,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const create = buildArticleNoteCreate(ctx, user, post, deps.apiBaseUrl)
  await fanOut(deps, ctx, user, create, { relayActivity: relayCreate(post, create) })
}

export const deliverFeedArticleUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableArticle,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const update = buildArticleNoteUpdate(ctx, user, post, deps.apiBaseUrl)
  await fanOut(deps, ctx, user, update, { relayActivity: relayEdit(ctx, user, post, update) })
}

// Challenge shares (#994). A challenge invitation federates as a `Note` (like
// an article): the user's markdown note + the challenge's canonical public
// URL. Mastodon renders the link with the challenge page's existing OG preview
// card. Served on the SAME object path as every post kind, so it tombstones
// like any post. No activity to resolve; an opted-in post delivered to
// followers attaches the standings race chart (`standings.png`).

/** The delivery-facing view of a challenge post (its `challenge` guaranteed present). */
export interface DeliverableChallenge {
  id: string
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
  challenge: ChallengeShare
  message: string | null
  /** Attach the rendered standings race chart. */
  include_chart: boolean
  /** Capability token appended to a `followers`-only post's image URL. */
  image_token: string
  tags?: readonly string[]
}

export const toDeliverableChallenge = (post: FeedPostRecord): DeliverableChallenge | null =>
  post.kind === 'challenge' && post.challenge != null
    ? {
        challenge: post.challenge,
        created_at: post.created_at,
        id: post.id,
        image_token: post.image_token,
        include_chart: post.include_chart,
        message: post.message,
        tags: post.tags,
        updated_at: post.updated_at,
        visibility: post.visibility,
      }
    : null

/**
 * The `Standings` race-chart attachment of an opted-in challenge post, under
 * the same URL rules as `imageAttachments`: a `followers`-only post's URL
 * carries its capability `token`, every URL the post's version `v`, and only
 * an image with data behind it (`available`) is attached.
 */
export const challengeImageAttachments = (
  apiBaseUrl: string,
  user: string,
  post: Pick<DeliverableChallenge, 'id' | 'image_token' | 'include_chart' | 'updated_at' | 'visibility'>,
  available: boolean,
): Image[] => {
  if (!post.include_chart || !available) return []
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(user)}/feed/${post.id}`
  const params = new URLSearchParams()
  if (!isPubliclyVisible(post.visibility)) params.set('token', post.image_token)
  params.set('v', String(post.updated_at.getTime()))
  return [
    new Image({
      height: CHART_HEIGHT,
      mediaType: 'image/png',
      name: 'Standings',
      url: new URL(`${base}/standings.png?${params.toString()}`),
      width: CHART_WIDTH,
    }),
  ]
}

/** Whether a challenge post's standings would draw at least one race line (what `standings.png` needs). */
export type HasDrawableStandings = (user: string, post: DeliverableChallenge) => Promise<boolean>

export const hasDrawableStandings: HasDrawableStandings = async (user, post) => {
  if (!post.include_chart) return false
  try {
    const chart = await resolveStandingsChart(user, {
      challenge: post.challenge,
      kind: 'challenge',
      message: post.message,
    })
    return chart != null && chart.lines.length > 0
  } catch (error) {
    console.warn(`⚠️ Standings chart availability for post ${post.id} failed:`, error)
    return false
  }
}

/**
 * Someone an activity tags: the actor id the `Mention` points at and its
 * `@user@host` name. A completion post tags its winners; a reply tags the
 * author of the post it answers.
 */
export interface MentionRecipient {
  actorUri: URL
  handle: string
  /**
   * The actor's inbox, when the caller already resolved it (the reply path
   * checks reachability before writing the post, #1108) — delivery then skips
   * its own `lookupObject` round-trip for the same actor.
   */
  inbox?: ResolvedInbox
}

/** An already-resolved actor inbox, as cached on a followee row or freshly looked up. */
export interface ResolvedInbox {
  inbox_uri: string
  shared_inbox_uri: string | null
}

/**
 * The winners (rank 1) of a completion post's result, as Mentions. An
 * invitation (no result) mentions nobody. A member whose identity can't be
 * mapped to an actor is left out rather than tagged with a broken href.
 */
export const challengeMentions = (challenge: ChallengeShare): MentionRecipient[] => {
  if (challenge.result == null) return []
  const mentions: MentionRecipient[] = []
  for (const entry of challengeWinners(challenge.result)) {
    const actorUri = identityToActorUri(entry.identity_base_url)
    const handle = identityToHandle(entry.identity_base_url)
    if (actorUri != null && handle != null) {
      mentions.push({ actorUri: new URL(actorUri), handle: `@${handle}` })
    }
  }
  return mentions
}

/**
 * Addressing for a challenge post: the visibility table, plus every mentioned
 * winner in `cc` (Mastodon-style — a mention is addressed as well as tagged, so
 * the winner's server accepts it even when they don't follow the host).
 */
const challengeAddressing = (
  ctx: Context<void>,
  user: string,
  post: DeliverableChallenge,
): { to: URL[]; cc: URL[]; mentions: MentionRecipient[] } => {
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  const mentions = challengeMentions(post.challenge)
  return { cc: [...cc, ...mentions.map((m) => m.actorUri)], mentions, to }
}

/**
 * Build the Fedify `Note` for a challenge share: name heading + sanitised
 * markdown note + canonical link as `content` (a completion post: the podium),
 * addressed per visibility, at the post's canonical Note id, with a `Mention`
 * tag per winner. Synchronous: the delivery path resolves the `Standings`
 * attachment beforehand (`challengeImageAttachments`); the object dispatcher
 * and outbox serve the Note without it.
 */
export const buildChallengeNote = (
  ctx: Context<void>,
  user: string,
  post: DeliverableChallenge,
  attachments: Image[] = [],
): Note => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, mentions, to } = challengeAddressing(ctx, user, post)
  const hashtags = noteHashtags(ctx, user, post.tags)
  return new Note({
    attachments,
    attribution: ctx.getActorUri(user),
    ccs: cc,
    content: linkifyHashtags(renderChallengeShareHtml(post.challenge, post.message), hashtags),
    id: noteId,
    interactionPolicy: quoteInteractionPolicy(post.visibility, ctx.getActorUri(user)),
    name: post.challenge.name,
    published: dateToTemporalInstant(post.created_at),
    tags: [
      ...mentions.map((m) => new Mention({ href: m.actorUri, name: m.handle })),
      ...hashtagObjects(hashtags),
    ],
    tos: to,
    updated: dateToTemporalInstant(post.updated_at),
    url: noteId,
  })
}

/** Wrap the challenge Note in the `Create` delivered to followers and listed in the outbox. */
export const buildChallengeNoteCreate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableChallenge,
  attachments: Image[] = [],
): Create => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = challengeAddressing(ctx, user, post)
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: buildChallengeNote(ctx, user, post, attachments),
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
}

/** Wrap the challenge Note in an `Update`; id carries `updated_at` so each edit is distinct. */
export const buildChallengeNoteUpdate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableChallenge,
  attachments: Image[] = [],
): Update => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = challengeAddressing(ctx, user, post)
  return new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: buildChallengeNote(ctx, user, post, attachments),
    tos: to,
  })
}

/** The Fedify recipient for an already-resolved inbox (no actor document needed). */
const inboxRecipient = (actorUri: URL, inbox: ResolvedInbox) => ({
  endpoints: inbox.shared_inbox_uri ? { sharedInbox: new URL(inbox.shared_inbox_uri) } : null,
  id: actorUri,
  inboxId: new URL(inbox.inbox_uri),
})

/**
 * Deliver an activity to each mentioned actor's own inbox (besides the
 * followers fan-out), so someone who doesn't follow us is still told: a
 * challenge winner, or the author of the post a reply answers. We ourselves
 * are skipped (our own feed already has the post). Each lookup/POST is
 * best-effort and independent: one unreachable recipient never costs another
 * their notification. Remote servers dedupe by activity id, so a mentioned
 * follower sees it once.
 *
 * The actor is dereferenced by its id (`lookupObject`) rather than read off
 * anything inline, so the inbox we POST to is the one that id's own server
 * publishes — unless the caller already resolved that same inbox and passed it
 * along, which is the identical answer without the second round-trip.
 */
const deliverToMentioned = async (
  ctx: Context<void>,
  user: string,
  mentions: MentionRecipient[],
  activity: Activity,
): Promise<void> => {
  const self = ctx.getActorUri(user).href
  for (const mention of mentions) {
    if (mention.actorUri.href === self) continue
    try {
      const recipient =
        mention.inbox == null
          ? await ctx.lookupObject(mention.actorUri, await signedFetchOptions(ctx, user))
          : mention.inbox
      if (recipient != null && 'inbox_uri' in recipient) {
        await ctx.sendActivity({ identifier: user }, inboxRecipient(mention.actorUri, recipient), activity)
        continue
      }
      if (!isActor(recipient)) {
        // `lookupObject` yields null (not an error) when the actor document can't
        // be loaded.
        console.warn(`⚠️ Mention delivery to ${mention.handle} skipped: actor not resolvable`)
        continue
      }
      await ctx.sendActivity({ identifier: user }, recipient, activity)
    } catch (error) {
      console.warn(`⚠️ Mention delivery to ${mention.handle} failed:`, error)
    }
  }
}

/** Mastodon pushes public posts only to relays: not unlisted, not followers-only. */
const toRelays = (post: { visibility: FeedVisibility }): boolean => post.visibility === 'public'

const relayCreate = (post: { visibility: FeedVisibility }, create: Activity): Activity | null =>
  toRelays(post) ? create : null

/**
 * What relays get for an edit: the Update while the post is public, else a
 * public-addressed Delete, so a post narrowed from public is retracted from the
 * relays and its narrowed content never reaches them. A post widened to public
 * reaches them only as an Update, which a relay may ignore.
 */
const relayEdit = (
  ctx: Context<void>,
  user: string,
  post: { id: string; visibility: FeedVisibility },
  update: Activity,
): Activity => (toRelays(post) ? update : buildFeedDelete(ctx, user, { id: post.id, visibility: 'public' }))

/**
 * Deliver to each accepted relay's inbox, signed by the post's author. Each relay
 * is its own best-effort send, so a dead relay costs no other relay its copy.
 */
export const deliverToRelays = async (
  deps: Pick<FeedDeliveryDeps, 'listRelayRecipients'>,
  ctx: Context<void>,
  user: string,
  activity: Activity,
): Promise<void> => {
  if (deps.listRelayRecipients == null) return
  let relays: RelayRecipient[]
  try {
    relays = await deps.listRelayRecipients()
  } catch (error) {
    console.warn('⚠️ Relay list unavailable, posts not pushed to relays:', error)
    return
  }
  await Promise.all(
    relays.map((relay) =>
      ctx.sendActivity({ identifier: user }, relay, activity).catch((error: unknown) => {
        console.warn(`⚠️ Relay delivery to ${relay.inboxId.href} failed:`, error)
      }),
    ),
  )
}

/**
 * Mirror what the relays get onto the public tag pages: a public Create/Update of
 * a top-level Note is recorded (when it carries a configured tag), a Delete —
 * including the one that retracts a post narrowed from public — removes it.
 */
const recordPublicTagPost = async (
  deps: Pick<FeedDeliveryDeps, 'publicTagPosts'>,
  ctx: Context<void>,
  user: string,
  activity: Activity,
): Promise<void> => {
  const tagPosts = deps.publicTagPosts
  if (tagPosts == null) return
  try {
    if (activity instanceof Delete) {
      if (activity.objectId != null) await tagPosts.remove(user, activity.objectId.href)
      return
    }
    if (!(activity instanceof Create) && !(activity instanceof Update)) return
    const note = await activity.getObject()
    if (note instanceof Note && note.replyTargetIds.length === 0) await tagPosts.record(user, note, ctx)
  } catch (error) {
    console.warn('⚠️ Public tag page record failed:', error)
  }
}

/**
 * Fan an activity out to followers, to each tagged actor and (`relayActivity`,
 * when set) to the accepted relays — as independent deliveries. Without an outbox queue
 * Fedify awaits every follower inbox and one dead instance rejects the whole
 * send, which used to cancel the mention delivery that exists precisely for
 * people who don't follow us (#1079). All run concurrently; a followers failure
 * still surfaces to the caller after the others have settled.
 */
const fanOut = async (
  deps: FeedDeliveryDeps,
  ctx: Context<void>,
  user: string,
  activity: Activity,
  { mentions = [], relayActivity }: { mentions?: MentionRecipient[]; relayActivity: Activity | null },
): Promise<void> => {
  const [followers] = await Promise.allSettled([
    ctx.sendActivity({ identifier: user }, 'followers', activity),
    mentions.length > 0 ? deliverToMentioned(ctx, user, mentions, activity) : Promise.resolve(),
    relayActivity == null ? Promise.resolve() : deliverToRelays(deps, ctx, user, relayActivity),
    relayActivity == null ? Promise.resolve() : recordPublicTagPost(deps, ctx, user, relayActivity),
  ])
  if (followers.status === 'rejected') throw followers.reason
}

const deliveredChallengeAttachments = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableChallenge,
  hasStandings: HasDrawableStandings,
): Promise<Image[]> =>
  challengeImageAttachments(
    deps.apiBaseUrl,
    user,
    post,
    post.include_chart && (await hasStandings(user, post)),
  )

export const deliverFeedChallengePost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableChallenge,
  hasStandings: HasDrawableStandings = hasDrawableStandings,
): Promise<void> => {
  const attachments = await deliveredChallengeAttachments(deps, user, post, hasStandings)
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const create = buildChallengeNoteCreate(ctx, user, post, attachments)
  await fanOut(deps, ctx, user, create, {
    mentions: challengeMentions(post.challenge),
    relayActivity: relayCreate(post, create),
  })
}

/** An edit re-sends the attachment under the new `v`, so Mastodon fetches the chart afresh. */
export const deliverFeedChallengeUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableChallenge,
  hasStandings: HasDrawableStandings = hasDrawableStandings,
): Promise<void> => {
  const attachments = await deliveredChallengeAttachments(deps, user, post, hasStandings)
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const update = buildChallengeNoteUpdate(ctx, user, post, attachments)
  await fanOut(deps, ctx, user, update, {
    mentions: challengeMentions(post.challenge),
    relayActivity: relayEdit(ctx, user, post, update),
  })
}

// Exercise shares (#1398). An exercise's progress federates as a `Note` (like a challenge
// invitation) whose content is resolved from the exercise's data when the Note is built, so the
// builders take the pre-rendered `content` (`exerciseNoteContent`) and stay synchronous. Delivered
// to followers only (no mentions); an opted-in post attaches the trend line (`trend.png`).

/** The delivery-facing view of an exercise post (its `exercise` guaranteed present). */
export interface DeliverableExercise {
  id: string
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
  exercise: ExerciseShare
  message: string | null
  /** Attach the rendered trend image. */
  include_chart: boolean
  /** Capability token appended to a `followers`-only post's image URL. */
  image_token: string
  tags?: readonly string[]
}

export const toDeliverableExercise = (post: FeedPostRecord): DeliverableExercise | null =>
  post.kind === 'exercise' && post.exercise != null
    ? {
        created_at: post.created_at,
        exercise: post.exercise,
        id: post.id,
        image_token: post.image_token,
        include_chart: post.include_chart,
        message: post.message,
        tags: post.tags,
        updated_at: post.updated_at,
        visibility: post.visibility,
      }
    : null

/** The `Trend` attachment of an opted-in exercise post, under the same URL rules as `imageAttachments`. */
export const exerciseImageAttachments = (
  apiBaseUrl: string,
  user: string,
  post: Pick<DeliverableExercise, 'id' | 'image_token' | 'include_chart' | 'updated_at' | 'visibility'>,
  available: boolean,
): Image[] => {
  if (!post.include_chart || !available) return []
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(user)}/feed/${post.id}`
  const params = new URLSearchParams()
  if (!isPubliclyVisible(post.visibility)) params.set('token', post.image_token)
  params.set('v', String(post.updated_at.getTime()))
  return [
    new Image({
      height: CHART_HEIGHT,
      mediaType: 'image/png',
      name: 'Trend',
      url: new URL(`${base}/trend.png?${params.toString()}`),
      width: CHART_WIDTH,
    }),
  ]
}

/** Whether an exercise post's trend has the 2+ points `trend.png` needs. */
export type HasDrawableTrend = (user: string, post: DeliverableExercise) => Promise<boolean>

export const hasDrawableTrend: HasDrawableTrend = async (user, post) => {
  if (!post.include_chart) return false
  try {
    return (await resolveExerciseTrendSeries(user, { ...post, kind: 'exercise' })) != null
  } catch (error) {
    console.warn(`⚠️ Trend availability for post ${post.id} failed:`, error)
    return false
  }
}

/** Build the Fedify `Note` for an exercise share from its pre-rendered `content`. */
export const buildExerciseNote = (
  ctx: Context<void>,
  user: string,
  post: DeliverableExercise,
  content: string,
  attachments: Image[] = [],
): Note => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  const hashtags = noteHashtags(ctx, user, post.tags)
  return new Note({
    attachments,
    attribution: ctx.getActorUri(user),
    ccs: cc,
    content: linkifyHashtags(content, hashtags),
    id: noteId,
    interactionPolicy: quoteInteractionPolicy(post.visibility, ctx.getActorUri(user)),
    name: post.exercise.name,
    published: dateToTemporalInstant(post.created_at),
    tags: hashtagObjects(hashtags),
    tos: to,
    updated: dateToTemporalInstant(post.updated_at),
    url: noteId,
  })
}

/** Wrap the exercise Note in the `Create` delivered to followers and listed in the outbox. */
export const buildExerciseNoteCreate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableExercise,
  content: string,
  attachments: Image[] = [],
): Create => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: buildExerciseNote(ctx, user, post, content, attachments),
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
}

/** Wrap the exercise Note in an `Update`; id carries `updated_at` so each edit is distinct. */
export const buildExerciseNoteUpdate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableExercise,
  content: string,
  attachments: Image[] = [],
): Update => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: buildExerciseNote(ctx, user, post, content, attachments),
    tos: to,
  })
}

export interface ExerciseDeliveryHooks {
  hasTrend: HasDrawableTrend
  content: (user: string, post: DeliverableExercise) => Promise<string>
}

const defaultExerciseHooks: ExerciseDeliveryHooks = {
  content: exerciseNoteContent,
  hasTrend: hasDrawableTrend,
}

const preparedExerciseNote = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableExercise,
  hooks: ExerciseDeliveryHooks,
): Promise<{ content: string; attachments: Image[] }> => {
  const [content, trend] = await Promise.all([
    hooks.content(user, post),
    post.include_chart ? hooks.hasTrend(user, post) : Promise.resolve(false),
  ])
  return { attachments: exerciseImageAttachments(deps.apiBaseUrl, user, post, trend), content }
}

export const deliverFeedExercisePost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableExercise,
  hooks: ExerciseDeliveryHooks = defaultExerciseHooks,
): Promise<void> => {
  const { attachments, content } = await preparedExerciseNote(deps, user, post, hooks)
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const create = buildExerciseNoteCreate(ctx, user, post, content, attachments)
  await fanOut(deps, ctx, user, create, { relayActivity: relayCreate(post, create) })
}

/** An edit re-sends the attachment under the new `v`, so Mastodon fetches the trend afresh. */
export const deliverFeedExerciseUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableExercise,
  hooks: ExerciseDeliveryHooks = defaultExerciseHooks,
): Promise<void> => {
  const { attachments, content } = await preparedExerciseNote(deps, user, post, hooks)
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const update = buildExerciseNoteUpdate(ctx, user, post, content, attachments)
  await fanOut(deps, ctx, user, update, { relayActivity: relayEdit(ctx, user, post, update) })
}

// A dashboard Note's content is resolved from the stored config snapshot before the Note is built,
// so these builders take the pre-rendered `content` (`dashboardNoteContent`) and stay synchronous.

/** The delivery-facing view of a dashboard post (its `dashboard` guaranteed present). */
export interface DeliverableDashboard {
  id: string
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
  dashboard: DashboardShare
  message: string | null
  tags?: readonly string[]
}

export const toDeliverableDashboard = (post: FeedPostRecord): DeliverableDashboard | null =>
  post.kind === 'dashboard' && post.dashboard != null
    ? {
        created_at: post.created_at,
        dashboard: post.dashboard,
        id: post.id,
        message: post.message,
        tags: post.tags,
        updated_at: post.updated_at,
        visibility: post.visibility,
      }
    : null

/** Build the Fedify `Note` for a dashboard-period share from its pre-rendered `content`. */
export const buildDashboardNote = (
  ctx: Context<void>,
  user: string,
  post: DeliverableDashboard,
  content: string,
): Note => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  const hashtags = noteHashtags(ctx, user, post.tags)
  return new Note({
    attribution: ctx.getActorUri(user),
    ccs: cc,
    content: linkifyHashtags(content, hashtags),
    id: noteId,
    interactionPolicy: quoteInteractionPolicy(post.visibility, ctx.getActorUri(user)),
    name: post.dashboard.name,
    published: dateToTemporalInstant(post.created_at),
    tags: hashtagObjects(hashtags),
    tos: to,
    updated: dateToTemporalInstant(post.updated_at),
    url: noteId,
  })
}

/** Wrap the dashboard Note in the `Create` delivered to followers and listed in the outbox. */
export const buildDashboardNoteCreate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableDashboard,
  content: string,
): Create => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: buildDashboardNote(ctx, user, post, content),
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
}

/** Wrap the dashboard Note in an `Update`; id carries `updated_at` so each edit is distinct. */
export const buildDashboardNoteUpdate = (
  ctx: Context<void>,
  user: string,
  post: DeliverableDashboard,
  content: string,
): Update => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  return new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: buildDashboardNote(ctx, user, post, content),
    tos: to,
  })
}

export type DashboardNoteContent = (user: string, post: DeliverableDashboard) => Promise<string>

export const deliverFeedDashboardPost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableDashboard,
  content: DashboardNoteContent = dashboardNoteContent,
): Promise<void> => {
  const html = await content(user, post)
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const create = buildDashboardNoteCreate(ctx, user, post, html)
  await fanOut(deps, ctx, user, create, { relayActivity: relayCreate(post, create) })
}

export const deliverFeedDashboardUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableDashboard,
  content: DashboardNoteContent = dashboardNoteContent,
): Promise<void> => {
  const html = await content(user, post)
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const update = buildDashboardNoteUpdate(ctx, user, post, html)
  await fanOut(deps, ctx, user, update, { relayActivity: relayEdit(ctx, user, post, update) })
}

// Replies (comments). A reply federates as a `Note` with `inReplyTo` pointing at
// the post it answers and a `Mention` of that post's author — exactly how
// Mastodon threads a reply. It is delivered to our followers AND to the
// author's own inbox, because they need not follow us. Served on the SAME
// object path as every other post kind, so it tombstones like any post.

/** The delivery-facing view of a reply post (its reply target guaranteed present). */
export interface DeliverableReply {
  id: string
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
  message: string | null
  in_reply_to_uri: string
  in_reply_to_actor_uri: string
  in_reply_to_handle: string | null
  tags?: readonly string[]
}

export const toDeliverableReply = (post: FeedPostRecord): DeliverableReply | null =>
  post.kind === 'reply' && post.in_reply_to_uri != null && post.in_reply_to_actor_uri != null
    ? {
        created_at: post.created_at,
        id: post.id,
        in_reply_to_actor_uri: post.in_reply_to_actor_uri,
        in_reply_to_handle: post.in_reply_to_handle,
        in_reply_to_uri: post.in_reply_to_uri,
        message: post.message,
        tags: post.tags,
        updated_at: post.updated_at,
        visibility: post.visibility,
      }
    : null

/**
 * The single actor a reply tags: the author of the post it answers. Empty when
 * the target author isn't known (nothing to tag, and no bogus href).
 */
export const replyMentions = (
  post: Pick<ReplyContentSource, 'in_reply_to_actor_uri' | 'in_reply_to_handle'>,
  /** The author's inbox, already resolved by the reply handler (#1108). */
  inbox?: ResolvedInbox,
): MentionRecipient[] => {
  if (post.in_reply_to_actor_uri == null) return []
  let actorUri: URL
  try {
    actorUri = new URL(post.in_reply_to_actor_uri)
  } catch {
    return []
  }
  return [{ actorUri, handle: replyMentionName({ ...post, message: null }), ...(inbox && { inbox }) }]
}

/**
 * Addressing for a reply: the visibility table, plus the replied-to author in
 * `cc` (Mastodon-style — a mention is addressed as well as tagged, so their
 * server accepts the reply even when they don't follow us).
 */
const replyAddressing = (
  ctx: Context<void>,
  user: string,
  post: DeliverableReply,
): { to: URL[]; cc: URL[]; mentions: MentionRecipient[] } => {
  const { cc, to } = recipients(post.visibility, ctx.getFollowersUri(user))
  const mentions = replyMentions(post)
  return { cc: [...cc, ...mentions.map((m) => m.actorUri)], mentions, to }
}

/**
 * Build the Fedify `Note` for a reply: `inReplyTo` the answered object, the
 * mention link + the author's markdown as `content`, addressed per visibility,
 * at the post's canonical Note id, with the target author as a `Mention` tag.
 * Synchronous — nothing to resolve.
 */
export const buildReplyNote = (ctx: Context<void>, user: string, post: DeliverableReply): Note => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, mentions, to } = replyAddressing(ctx, user, post)
  const hashtags = noteHashtags(ctx, user, post.tags)
  return new Note({
    attribution: ctx.getActorUri(user),
    ccs: cc,
    content: linkifyHashtags(renderReplyContent(post), hashtags),
    id: noteId,
    interactionPolicy: quoteInteractionPolicy(post.visibility, ctx.getActorUri(user)),
    published: dateToTemporalInstant(post.created_at),
    replyTarget: new URL(post.in_reply_to_uri),
    tags: [
      ...mentions.map((m) => new Mention({ href: m.actorUri, name: m.handle })),
      ...hashtagObjects(hashtags),
    ],
    tos: to,
    updated: dateToTemporalInstant(post.updated_at),
    url: noteId,
  })
}

/** Wrap the reply Note in the `Create` delivered to followers + the author, and listed in the outbox. */
export const buildReplyNoteCreate = (ctx: Context<void>, user: string, post: DeliverableReply): Create => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = replyAddressing(ctx, user, post)
  return new Create({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#create`),
    object: buildReplyNote(ctx, user, post),
    published: dateToTemporalInstant(post.created_at),
    tos: to,
  })
}

/** Wrap the reply Note in an `Update`; id carries `updated_at` so each edit is distinct. */
export const buildReplyNoteUpdate = (ctx: Context<void>, user: string, post: DeliverableReply): Update => {
  const noteId = ctx.getObjectUri(Note, { identifier: user, postId: post.id })
  const { cc, to } = replyAddressing(ctx, user, post)
  return new Update({
    actor: ctx.getActorUri(user),
    ccs: cc,
    id: new URL(`${noteId.href}#update-${post.updated_at.getTime()}`),
    object: buildReplyNote(ctx, user, post),
    tos: to,
  })
}

/**
 * Build and send the `Create{Note}` for a fresh reply to followers and the
 * answered author. `authorInbox` is the inbox the reply handler already resolved
 * as its reachability gate (#1108) — passing it here spends that answer instead
 * of looking the same actor up again.
 */
export const deliverFeedReplyPost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableReply,
  authorInbox?: ResolvedInbox,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const create = buildReplyNoteCreate(ctx, user, post)
  await fanOut(deps, ctx, user, create, { mentions: replyMentions(post, authorInbox), relayActivity: null })
}

export const deliverFeedReplyUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverableReply,
): Promise<void> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const update = buildReplyNoteUpdate(ctx, user, post)
  await fanOut(deps, ctx, user, update, { mentions: replyMentions(post), relayActivity: null })
}
