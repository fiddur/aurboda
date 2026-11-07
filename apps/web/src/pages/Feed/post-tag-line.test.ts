import type { FeedPost } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { bodyShowsContentHtml, postTagLine } from './post-tag-line'

const base = {
  content: '<p>Run <a class="mention hashtag">#<span>aurboda</span></a></p>',
  created_at: '2026-07-01T00:00:00.000Z',
  id: 'p1',
  kind: 'activity',
  tags: ['aurboda', 'running'],
  visibility: 'public',
} as unknown as FeedPost

describe('postTagLine', () => {
  test('a body of plain content HTML already links the tags', () => {
    expect(bodyShowsContentHtml(base, false)).toBe(true)
    expect(postTagLine(base, false)).toEqual([])
  })

  test('a native body lists the tags', () => {
    const withMetrics = { ...base, metrics: {} } as unknown as FeedPost
    expect(postTagLine(withMetrics, false)).toEqual(['aurboda', 'running'])
    expect(postTagLine({ ...base, kind: 'reply' } as FeedPost, true)).toEqual(['aurboda', 'running'])
  })

  test('an exercise post without structure or exercise falls back to content', () => {
    const exercise = { ...base, kind: 'exercise' } as FeedPost
    expect(bodyShowsContentHtml(exercise, false)).toBe(true)
    expect(
      bodyShowsContentHtml({ ...exercise, exercise: { name: 'Squat' } } as unknown as FeedPost, false),
    ).toBe(false)
  })

  test('an article renders its own blocks', () => {
    const article = {
      ...base,
      article: { blocks: [], title: 'T' },
      kind: 'article',
    } as unknown as FeedPost
    expect(postTagLine(article, false)).toEqual(['aurboda', 'running'])
  })
})
