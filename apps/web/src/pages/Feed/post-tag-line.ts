import type { FeedPost } from '@aurboda/api-spec'

import { articleRenderSource } from './article-render-source'

/**
 * Whether the card body is the server-built `content` HTML, which already links
 * the post's tags; every other body gets its own tag line. Mirrors `FeedPostBody`.
 */
export const bodyShowsContentHtml = (post: FeedPost, visitor: boolean): boolean => {
  if (articleRenderSource(post, visitor) != null) return false
  if (post.structured?.kind === 'challenge' || post.kind === 'reply') return false
  if (post.kind === 'challenge' && post.challenge) return false
  if (post.kind === 'exercise') {
    return post.structured?.kind !== 'exercise' && !post.exercise && !!post.content
  }
  if (post.structured || post.metrics) return false
  return !!post.content
}

/** The tags the card lists under its body: none when the body already shows them. */
export const postTagLine = (post: FeedPost, visitor: boolean): string[] =>
  bodyShowsContentHtml(post, visitor) ? [] : post.tags
