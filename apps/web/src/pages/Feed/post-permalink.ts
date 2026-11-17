import type { FeedPost } from '@aurboda/api-spec'

/**
 * The in-app path of a post's permalink page (`/u/:username/posts/:id`), or null when that page
 * would not show it. Everybody sees `public` and `unlisted` posts there; the signed-in author
 * (`own`) also sees their `followers` posts, which are "Post not found" for anyone else.
 */
export const postPermalinkPath = (
  username: string,
  post: Pick<FeedPost, 'id' | 'visibility'>,
  own = false,
): string | null =>
  own || post.visibility === 'public' || post.visibility === 'unlisted'
    ? `/u/${encodeURIComponent(username)}/posts/${encodeURIComponent(post.id)}`
    : null
