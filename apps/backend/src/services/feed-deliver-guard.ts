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
  updated: (user, post) => {
    if (deliverable(post)) deliver.updated(user, post)
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

/**
 * Federate an edit as an `Update` through the hook for the post's kind: a post with no linked
 * activity must go through its own kind's path, where the generic `updated` would no-op.
 */
export const deliverFeedPostEdit = (
  deliver: FeedDeliver | undefined,
  user: string,
  record: FeedPostRecord,
): void => {
  if (deliver == null) return
  if (record.kind === 'article') deliver.updatedArticle(user, record)
  else if (record.kind === 'challenge') deliver.updatedChallenge(user, record)
  else if (record.kind === 'exercise') deliver.updatedExercise(user, record)
  else if (record.kind === 'dashboard') deliver.updatedDashboard(user, record)
  else if (record.kind === 'reply') deliver.updatedReply(user, record)
  else deliver.updated(user, record)
}
