import type { FeedPostRecord } from '../../db/index.ts'

import { resolveFeedActivity } from '../feed.ts'
import { withTimeout } from '../with-timeout.ts'
import {
  deliverFeedArticleUpdate,
  deliverFeedChallengeUpdate,
  deliverFeedDashboardUpdate,
  deliverFeedExerciseUpdate,
  deliverFeedReplyUpdate,
  deliverFeedUpdate,
  type FeedDeliveryDeps,
  toDeliverableArticle,
  toDeliverableChallenge,
  toDeliverableDashboard,
  toDeliverableExercise,
  toDeliverableReply,
} from './deliver.ts'

/** The `Update` an edit of this post would send, whatever its kind, awaited. */
export const deliverPostUpdate = async (
  deps: FeedDeliveryDeps,
  user: string,
  post: FeedPostRecord,
): Promise<void> => {
  const article = toDeliverableArticle(post)
  if (article != null) return await deliverFeedArticleUpdate(deps, user, article)
  const challenge = toDeliverableChallenge(post)
  if (challenge != null) return await deliverFeedChallengeUpdate(deps, user, challenge)
  const exercise = toDeliverableExercise(post)
  if (exercise != null) return await deliverFeedExerciseUpdate(deps, user, exercise)
  const dashboard = toDeliverableDashboard(post)
  if (dashboard != null) return await deliverFeedDashboardUpdate(deps, user, dashboard)
  const reply = toDeliverableReply(post)
  if (reply != null) return await deliverFeedReplyUpdate(deps, user, reply)
  if (post.activity_id == null) return
  const activity = await resolveFeedActivity(user, post.activity_id)
  if (activity != null) await deliverFeedUpdate(deps, user, post, activity)
}

export interface PostUpdateResendDeps {
  listUsers: () => Promise<string[]>
  /** The user's public and unlisted posts: the ones that federated with an addressable Note. */
  listPosts: (user: string) => Promise<FeedPostRecord[]>
  deliver: (user: string, post: FeedPostRecord) => Promise<void>
  /** How long one post's delivery may take before it counts as failed and the run moves on. */
  timeoutMs?: number
}

const POST_DELIVERY_TIMEOUT_MS = 60_000

export interface PostUpdateResend {
  posts: number
  /** Settles once every Update was attempted; never rejects. */
  done: Promise<void>
}

export interface PostUpdateResender {
  /** Null while an earlier re-send is still delivering. */
  start: () => Promise<PostUpdateResend | null>
}

const listEligible = async (
  deps: PostUpdateResendDeps,
): Promise<{ user: string; posts: FeedPostRecord[] }[]> => {
  const batches: { user: string; posts: FeedPostRecord[] }[] = []
  for (const user of await deps.listUsers()) {
    try {
      batches.push({ posts: await deps.listPosts(user), user })
    } catch (error) {
      console.warn(`⚠️ post Update re-send: could not list ${user}'s posts:`, error)
    }
  }
  return batches
}

const deliverAll = async (
  deps: PostUpdateResendDeps,
  batches: { user: string; posts: FeedPostRecord[] }[],
): Promise<number> => {
  let failed = 0
  for (const { posts, user } of batches) {
    for (const post of posts) {
      try {
        await withTimeout(deps.deliver(user, post), deps.timeoutMs ?? POST_DELIVERY_TIMEOUT_MS)
      } catch (error) {
        failed++
        console.warn(`⚠️ post Update re-send failed for ${user}/${post.id}:`, error)
      }
    }
  }
  return failed
}

/**
 * Re-sends the `Update` of every public and unlisted post of every user (#1549). Mastodon cached
 * "nobody may quote" for posts federated before their Notes declared a quote policy, and an Update
 * of the Note is what refreshes it. Only Updates are sent, so running it again is harmless. The
 * posts are listed up front and delivered one after another in the background, so one run never
 * floods followers' servers with every post at once.
 */
export const createPostUpdateResender = (deps: PostUpdateResendDeps): PostUpdateResender => {
  let running = false
  return {
    start: async () => {
      if (running) return null
      running = true
      let batches: { user: string; posts: FeedPostRecord[] }[]
      try {
        batches = await listEligible(deps)
      } catch (error) {
        running = false
        throw error
      }
      const posts = batches.reduce((n, batch) => n + batch.posts.length, 0)
      console.info(`📤 post Update re-send started: ${posts} posts`)
      const done = deliverAll(deps, batches)
        .then((failed) => console.info(`📤 post Update re-send finished: ${posts} posts, ${failed} failed`))
        .finally(() => {
          running = false
        })
      return { done, posts }
    },
  }
}
