import type { FeedPost, FeedStructuredArticle } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { articleRenderSource } from './article-render-source'

const liveArticle: NonNullable<FeedPost['article']> = {
  blocks: [{ metric: 'heart_rate', type: 'chart' }],
  default_end: '2026-07-02T00:00:00.000Z',
  default_start: '2026-07-01T00:00:00.000Z',
  title: 'Resting HR',
}

const resolved: FeedStructuredArticle = {
  blocks: [
    {
      bucket: '1h',
      end: '2026-07-02T00:00:00.000Z',
      metric: 'heart_rate',
      samples: [],
      start: '2026-07-01T00:00:00.000Z',
      type: 'chart',
    },
  ],
  kind: 'article',
  title: 'Resting HR',
}

const post = (overrides: Partial<FeedPost>): FeedPost => ({
  activity_id: null,
  created_at: '2026-07-02T00:00:00.000Z',
  id: '00000000-0000-0000-0000-000000000001',
  include_chart: false,
  include_map: false,
  included_metrics: [],
  kind: 'article',
  series_metrics: [],
  updated_at: '2026-07-02T00:00:00.000Z',
  visibility: 'public',
  ...overrides,
})

describe('articleRenderSource', () => {
  test('a visitor renders the server-resolved article', () => {
    expect(articleRenderSource(post({ article: liveArticle, structured: resolved }), true)).toEqual({
      article: resolved,
      kind: 'resolved',
    })
  })

  test('the owner keeps the live article even when a resolved one is attached', () => {
    expect(articleRenderSource(post({ article: liveArticle, structured: resolved }), false)).toEqual({
      article: liveArticle,
      kind: 'live',
    })
  })

  test('a visitor falls back to the live article when none was resolved', () => {
    expect(articleRenderSource(post({ article: liveArticle }), true)).toEqual({
      article: liveArticle,
      kind: 'live',
    })
  })

  test('a non-article post has no article source', () => {
    expect(articleRenderSource(post({ kind: 'activity' }), true)).toBeNull()
  })

  test('an article post with neither body has no article source', () => {
    expect(articleRenderSource(post({}), true)).toBeNull()
  })
})
