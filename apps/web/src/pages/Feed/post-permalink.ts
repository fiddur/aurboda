import type { FeedPost } from '@aurboda/api-spec'

/**
 * The in-app path of a post's public permalink page (`/u/:username/posts/:id`), or null when
 * that page would not show it: only `public` and `unlisted` posts resolve there.
 */
export const postPermalinkPath = (
  username: string,
  post: Pick<FeedPost, 'id' | 'visibility'>,
): string | null =>
  post.visibility === 'public' || post.visibility === 'unlisted'
    ? `/u/${encodeURIComponent(username)}/posts/${encodeURIComponent(post.id)}`
    : null
