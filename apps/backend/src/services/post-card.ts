/**
 * What a feed post's permalink preview says: a title and a plain-text description, for its
 * share meta and its rendered Open Graph card. Built from the stored post (plus, for an
 * activity post, its activity's headline), never the full serialised post: the permalink and
 * its image are fetched by every crawler and visitor.
 */
import type { FeedPostKind } from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/feed.ts'

import { isMissingDatabase } from '../db/pg-errors.ts'
import { proseToPlainText } from './activitypub/article-object.ts'
import { clampTitle } from './og-image.ts'
import { postChartBucketMs } from './post-chart.ts'

export interface PostSummary {
  title: string
  /** Plain text on one line; empty when the post has nothing to say beyond its title. */
  description: string
}

/**
 * A feed post resolved just far enough to build its permalink meta and card from. Only a
 * `public` post is described: an unlisted one is reachable but never described to crawlers.
 */
export type ResolvedPost =
  | { is_public: false }
  | {
      is_public: true
      kind: FeedPostKind
      title: string
      /** Plain text; may be empty (builders fall back to a generic line). */
      description: string
      created_at: string
      /** Busts the rendered card's memo on an edit. */
      updated_at: string
      /** How long the card's chart may stand before it is drawn afresh (`postChartBucketMs`); absent, until an edit. */
      chart_bucket_ms?: number
    }

type PostFields = Pick<
  FeedPostRecord,
  'activity_id' | 'article' | 'challenge' | 'dashboard' | 'exercise' | 'kind' | 'message'
>

const oneLine = (text: string): string => text.replaceAll(/\s+/g, ' ').trim()

const fallbackTitle = (username: string): string => `Post by ${username}`

const describeArticle = (username: string, post: PostFields): PostSummary => {
  const firstProse = post.article?.blocks.find((block) => block.type === 'prose')
  return {
    description: firstProse ? proseToPlainText(firstProse.markdown) : '',
    title: post.article?.title ?? fallbackTitle(username),
  }
}

const describeReply = (username: string, post: PostFields): PostSummary => {
  const firstLine = post.message?.trim().split('\n')[0]?.trim() ?? ''
  return {
    description: oneLine(post.message ?? ''),
    title: firstLine ? clampTitle(firstLine, 80) : fallbackTitle(username),
  }
}

const sharedName = (post: PostFields, activityHeadline: string | null): string | null | undefined => {
  switch (post.kind) {
    case 'activity':
      return activityHeadline
    case 'exercise':
      return post.exercise?.name
    case 'dashboard':
      return post.dashboard?.name
    case 'challenge':
      return post.challenge?.name
    default:
      return undefined
  }
}

/** `activityHeadline` is the shared activity's federated headline, or null when it is gone. */
export const describePost = (
  username: string,
  post: PostFields,
  activityHeadline: string | null = null,
): PostSummary => {
  if (post.kind === 'article') return describeArticle(username, post)
  if (post.kind === 'reply') return describeReply(username, post)
  return {
    description: oneLine(post.message ?? ''),
    title: sharedName(post, activityHeadline) ?? fallbackTitle(username),
  }
}

const POST_EYEBROW: Record<FeedPostKind, string> = {
  activity: 'Activity',
  article: 'Article',
  challenge: 'Challenge',
  dashboard: 'Dashboard',
  exercise: 'Exercise',
  reply: 'Post',
}

export const postEyebrow = (kind: FeedPostKind): string => POST_EYEBROW[kind]

export interface PostResolverDeps {
  getRecord: (username: string, postId: string) => Promise<FeedPostRecord | null>
  /** The shared activity's federated headline, or null when it is gone. */
  getActivityHeadline: (username: string, activityId: string) => Promise<string | null>
}

/**
 * Resolve a post for its permalink preview. Nothing past the visibility check is loaded for a
 * non-public post. Never throws: a missing user database or any failure resolves to null, so the
 * page falls back to generic meta and the image to the default rather than a 500.
 */
export const resolvePostWith =
  ({ getActivityHeadline, getRecord }: PostResolverDeps) =>
  async (username: string, postId: string): Promise<ResolvedPost | null> => {
    try {
      const record = await getRecord(username, postId)
      if (!record) return null
      if (record.visibility !== 'public') return { is_public: false }
      const headline =
        record.kind === 'activity' && record.activity_id
          ? await getActivityHeadline(username, record.activity_id)
          : null
      const chart_bucket_ms = postChartBucketMs(record)
      return {
        ...(chart_bucket_ms === undefined ? {} : { chart_bucket_ms }),
        created_at: record.created_at.toISOString(),
        is_public: true,
        kind: record.kind,
        updated_at: record.updated_at.toISOString(),
        ...describePost(username, record, headline),
      }
    } catch (error) {
      if (!isMissingDatabase(error)) console.error('Post preview resolve failed, using generic meta:', error)
      return null
    }
  }
