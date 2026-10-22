import type { FeedPost, FeedStructuredArticle } from '@aurboda/api-spec'

export type ArticleRenderSource =
  | { article: FeedStructuredArticle; kind: 'resolved' }
  | { article: NonNullable<FeedPost['article']>; kind: 'live' }
  | null

/**
 * Which body an article post renders from. The live blocks fetch the owner's
 * authenticated metric endpoints, so a visitor (the public profile) gets the
 * server-resolved article instead — the same payload a federated peer renders.
 * The owner keeps the live render, which reflects an edit immediately.
 */
export const articleRenderSource = (post: FeedPost, isVisitor: boolean): ArticleRenderSource => {
  if (post.kind !== 'article') return null
  if (isVisitor && post.structured?.kind === 'article') return { article: post.structured, kind: 'resolved' }
  if (post.article) return { article: post.article, kind: 'live' }
  return null
}
