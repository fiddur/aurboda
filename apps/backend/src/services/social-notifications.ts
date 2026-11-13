import { type FeedReactionKind, UUID_RE } from '@aurboda/api-spec'

import type { RaiseNotificationInput } from './notifications.ts'

export interface ActorLabel {
  actor_uri: string
  display_name: string | null
  handle: string | null
}

const FOLLOW_ACCEPTED_MIN_WAIT_MS = 5 * 60 * 1000
const SNIPPET_MAX = 140

export const actorLabel = (actor: ActorLabel): string =>
  actor.display_name?.trim() || actor.handle?.trim() || actor.actor_uri

/** The handle under a display-name title, so the person is identifiable; nothing when the title is already the handle. */
const handleBody = (actor: ActorLabel): string | undefined => {
  const handle = actor.handle?.trim()
  return handle && actorLabel(actor) !== handle ? handle : undefined
}

export const textSnippet = (text: string, max = SNIPPET_MAX): string => {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  const cut = collapsed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

const ENTITIES: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' }

const decodeEntities = (text: string): string =>
  text.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return ENTITIES[entity.toLowerCase()] ?? match
  })

export const htmlSnippet = (html: string, max = SNIPPET_MAX): string =>
  textSnippet(
    decodeEntities(
      html.replaceAll(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|blockquote)>/gi, ' ').replaceAll(/<[^>]*>/g, ''),
    ),
    max,
  )

const optional = (text: string): string | undefined => (text === '' ? undefined : text)

export interface InboundFollowEvent {
  actor: ActorLabel
  /** Whether the follow was stored accepted. */
  accepted: boolean
  /** The follower row as it was before this delivery, or null when there was none. */
  existing: { accepted: boolean } | null
  follow_activity_uri: string | null
}

/** A first request in manual-approval mode, or a follower who just became accepted; a redelivery raises nothing. */
export const inboundFollowNotification = ({
  accepted,
  actor,
  existing,
  follow_activity_uri,
}: InboundFollowEvent): RaiseNotificationInput | null => {
  const key = follow_activity_uri ?? actor.actor_uri
  const data = { actor_uri: actor.actor_uri }
  if (!accepted) {
    if (existing != null) return null
    return {
      body: handleBody(actor),
      data,
      dedupe_key: `feed_follow_request:${key}`,
      link: '/feed',
      title: `${actorLabel(actor)} wants to follow you`,
      type: 'feed_follow_request',
    }
  }
  if (existing?.accepted === true) return null
  return {
    body: handleBody(actor),
    data,
    dedupe_key: `feed_new_follower:${key}`,
    link: '/feed',
    title: `${actorLabel(actor)} started following you`,
    type: 'feed_new_follower',
  }
}

/** Null when the follow was pending under five minutes: an instant auto-accept is not news. */
export const followAcceptedNotification = (
  actor: ActorLabel,
  requestedAt: Date,
  now: Date,
): RaiseNotificationInput | null => {
  if (now.getTime() - requestedAt.getTime() < FOLLOW_ACCEPTED_MIN_WAIT_MS) return null
  return {
    data: { actor_uri: actor.actor_uri },
    dedupe_key: `feed_follow_accepted:${actor.actor_uri}`,
    link: '/feed',
    title: `${actorLabel(actor)} accepted your follow request`,
    type: 'feed_follow_accepted',
  }
}

export const reactionNotification = (
  kind: FeedReactionKind,
  actor: ActorLabel,
  me: string,
  post: { id: string; message: string | null },
): RaiseNotificationInput => {
  const type = kind === 'like' ? 'feed_like' : 'feed_boost'
  return {
    body: post.message == null ? undefined : optional(textSnippet(post.message)),
    data: { actor_uri: actor.actor_uri, post_id: post.id },
    dedupe_key: `${type}:${post.id}:${actor.actor_uri}`,
    link: `/u/${encodeURIComponent(me)}/posts/${post.id}`,
    title: `${actorLabel(actor)} ${kind === 'like' ? 'liked' : 'boosted'} your post`,
    type,
  }
}

export interface TimelineEntryEvent {
  me: string
  /** `ownObjectPrefix(origin, me)`: the start of every one of the reader's own post ids. */
  own_object_prefix: string
  entry: {
    object_uri: string
    actor_uri: string
    handle?: string | null
    display_name?: string | null
    content: string
    in_reply_to_uri?: string | null
    mentions_me?: boolean
    boost_of_uri?: string | null
    boosted_by_actor_uri?: string | null
    boosted_by_handle?: string | null
    boosted_by_display_name?: string | null
  }
  /** The accepted followee this delivery is owed to (the booster for a boost card), or null for a stranger. */
  source: { notify_on_post: boolean; tag: string | null } | null
  /** Whether the reader's timeline lists the entry (`isVisibleToReader`). */
  visible: boolean
}

const ownPostIdOf = (inReplyTo: string | null | undefined, prefix: string): string | null => {
  if (inReplyTo == null || !inReplyTo.startsWith(prefix)) return null
  const postId = inReplyTo.slice(prefix.length)
  return UUID_RE.test(postId) ? postId : null
}

type TimelineEntry = TimelineEntryEvent['entry']

const authorOf = (entry: TimelineEntry): ActorLabel => ({
  actor_uri: entry.actor_uri,
  display_name: entry.display_name ?? null,
  handle: entry.handle ?? null,
})

const involvementNotification = (
  entry: TimelineEntry,
  me: string,
  ownObjectPrefix: string,
): RaiseNotificationInput | null => {
  const base = {
    body: optional(htmlSnippet(entry.content)),
    data: { actor_uri: entry.actor_uri, object_uri: entry.object_uri },
  }
  const repliedPostId = ownPostIdOf(entry.in_reply_to_uri, ownObjectPrefix)
  if (repliedPostId != null) {
    return {
      ...base,
      dedupe_key: `feed_reply:${entry.object_uri}`,
      link: `/u/${encodeURIComponent(me)}/posts/${repliedPostId}`,
      title: `${actorLabel(authorOf(entry))} replied to your post`,
      type: 'feed_reply',
    }
  }
  if (entry.mentions_me !== true) return null
  return {
    ...base,
    dedupe_key: `feed_mention:${entry.object_uri}`,
    link: '/feed',
    title: `${actorLabel(authorOf(entry))} mentioned you`,
    type: 'feed_mention',
  }
}

const postTitle = (entry: TimelineEntry): string => {
  const author = actorLabel(authorOf(entry))
  if (entry.boost_of_uri == null || entry.boosted_by_actor_uri == null) return `${author} posted`
  const booster = actorLabel({
    actor_uri: entry.boosted_by_actor_uri,
    display_name: entry.boosted_by_display_name ?? null,
    handle: entry.boosted_by_handle ?? null,
  })
  return `${booster} boosted ${author}`
}

const wantsPostNotification = ({ entry, source, visible }: TimelineEntryEvent): boolean =>
  visible &&
  source != null &&
  source.tag == null &&
  source.notify_on_post &&
  (entry.boost_of_uri != null || entry.in_reply_to_uri == null)

/**
 * For a newly stored entry on the live inbox path: a reply to the reader's own post, a mention
 * of them (a reply that also mentions them is one reply), or else a post from a followee whose
 * bell is on, top-level or a boost card, that the reader's timeline shows.
 */
export const timelineEntryNotification = (event: TimelineEntryEvent): RaiseNotificationInput | null => {
  const { entry } = event
  if (entry.boost_of_uri == null) {
    const involvement = involvementNotification(entry, event.me, event.own_object_prefix)
    if (involvement != null) return involvement
  }
  if (!wantsPostNotification(event)) return null
  return {
    body: optional(htmlSnippet(entry.content)),
    data: { actor_uri: entry.actor_uri, object_uri: entry.object_uri },
    dedupe_key: `feed_post:${entry.object_uri}`,
    link: '/feed',
    title: postTitle(entry),
    type: 'feed_post',
  }
}
