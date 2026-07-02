import type { FeedVisibility } from '@aurboda/api-spec'
/**
 * Deliver a shared feed post to the user's followers over ActivityPub.
 *
 * Builds a Fedify `Create{Note}` — the Mastodon-compatible representation: an
 * HTML `content` summary + `name`/`url`, addressed per the post's visibility —
 * and fans it out via `ctx.sendActivity(..., 'followers', …)`, which Fedify
 * signs, dedupes by shared inbox, and queues with retries.
 *
 * The custom `aurboda:` structured extension is not carried on the pushed Note
 * (Fedify's typed vocab drops unknown properties); it's progressive enhancement
 * an Aurboda consumer fetches by dereferencing the object id — served in a
 * follow-up slice. Delivery is best-effort: callers invoke it fire-and-forget.
 */
import type { Federation } from '@fedify/fedify'

import { Create, Note } from '@fedify/fedify/vocab'

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
}

export interface DeliverableActivity {
  activity_type: string
  start_time: Date
  end_time?: Date
  title?: string
}

/** Build and send the `Create{Note}` for a freshly-shared post to its followers. */
export const deliverFeedPost = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: DeliverablePost,
  activity: DeliverableActivity,
): Promise<void> => {
  const scalars = await resolveActivityScalars(user, activity, post.included_metrics)
  const { content, name } = feedPostContent(activity.title, activity.activity_type, scalars)

  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const actorUri = ctx.getActorUri(user)
  const followers = ctx.getFollowersUri(user)
  const postUrl = new URL(`${actorUri.href}/feed/${post.id}`)
  const { cc, to } = recipients(post.visibility, followers)

  // `published` is intentionally omitted: Fedify's vocab types it as the ambient
  // (esnext.temporal) Temporal.Instant, which the @js-temporal polyfill value
  // isn't assignable to. Delivery fires right after the share, so remote servers
  // timestamp it at receipt (≈ share time). Wiring an explicit published is a
  // follow-up (needs Temporal-lib interop sorted).
  const note = new Note({
    attribution: actorUri,
    ccs: cc,
    content,
    id: new URL(`${postUrl.href}/object`),
    name,
    tos: to,
    url: postUrl,
  })
  const create = new Create({ actor: actorUri, ccs: cc, id: postUrl, object: note, tos: to })

  await ctx.sendActivity({ identifier: user }, 'followers', create)
}
