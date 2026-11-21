import type { PostMention } from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/index.ts'
import type { FeedDeliver } from '../routes/feed-router.ts'

const deliverable = (post: Pick<FeedPostRecord, 'visibility'>): boolean => post.visibility !== 'participants'

/**
 * The delivery hooks with every `participants` post left out: such a post is for the people in
 * one challenge, so no `Create`, `Update` or `Delete` of it reaches followers, mentions or relays.
 */
export const withoutParticipantsDelivery = (deliver: FeedDeliver): FeedDeliver => ({
  created: (user, post, activity) => {
    if (deliverable(post)) deliver.created(user, post, activity)
  },
  createdArticle: (user, post) => {
    if (deliverable(post)) deliver.createdArticle(user, post)
  },
  createdChallenge: (user, post) => {
    if (deliverable(post)) deliver.createdChallenge(user, post)
  },
  createdDashboard: (user, post) => {
    if (deliverable(post)) deliver.createdDashboard(user, post)
  },
  createdExercise: (user, post) => {
    if (deliverable(post)) deliver.createdExercise(user, post)
  },
  createdReply: (user, post, authorInbox) => {
    if (deliverable(post)) deliver.createdReply(user, post, authorInbox)
  },
  deleted: (user, post, stamps) => {
    if (deliverable(post)) deliver.deleted(user, post, stamps)
  },
  updated: (user, post, droppedMentions) => {
    if (deliverable(post)) deliver.updated(user, post, droppedMentions)
  },
  updatedArticle: (user, post) => {
    if (deliverable(post)) deliver.updatedArticle(user, post)
  },
  updatedChallenge: (user, post) => {
    if (deliverable(post)) deliver.updatedChallenge(user, post)
  },
  updatedDashboard: (user, post) => {
    if (deliverable(post)) deliver.updatedDashboard(user, post)
  },
  updatedExercise: (user, post) => {
    if (deliverable(post)) deliver.updatedExercise(user, post)
  },
  updatedReply: (user, post) => {
    if (deliverable(post)) deliver.updatedReply(user, post)
  },
})

/** The accounts `before` mentioned that `after` no longer does. */
export const droppedMentions = (
  before: Pick<FeedPostRecord, 'mentions'>,
  after: Pick<FeedPostRecord, 'mentions'>,
): PostMention[] => {
  const kept = new Set((after.mentions ?? []).map((m) => m.actor_uri))
  return (before.mentions ?? []).filter((m) => !kept.has(m.actor_uri))
}

/**
 * Federate an edit as an `Update` through the hook for the post's kind: a post with no linked
 * activity must go through its own kind's path, where the generic `updated` would no-op. An
 * account the edit stopped mentioning (`previous` is the post before it) is sent the `Update`
 * too, since its server otherwise keeps showing the mention.
 */
export const deliverFeedPostEdit = (
  deliver: FeedDeliver | undefined,
  user: string,
  record: FeedPostRecord,
  previous?: Pick<FeedPostRecord, 'mentions'>,
): void => {
  if (deliver == null) return
  if (record.kind === 'article') deliver.updatedArticle(user, record)
  else if (record.kind === 'challenge') deliver.updatedChallenge(user, record)
  else if (record.kind === 'exercise') deliver.updatedExercise(user, record)
  else if (record.kind === 'dashboard') deliver.updatedDashboard(user, record)
  else if (record.kind === 'reply') deliver.updatedReply(user, record)
  else {
    const dropped = previous ? droppedMentions(previous, record) : []
    if (dropped.length > 0) deliver.updated(user, record, dropped)
    else deliver.updated(user, record)
  }
}
