import { activityHeadline, type FeedPost } from '@aurboda/api-spec'

/** An activity post's headline, as its federated Note and link-preview card give it. */
export const postHeadline = (post: Pick<FeedPost, 'activity_title' | 'activity_type'>): string =>
  post.activity_type
    ? activityHeadline(post.activity_title, post.activity_type)
    : (post.activity_title ?? 'Shared activity')
