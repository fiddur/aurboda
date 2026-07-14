import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { blockWindow, buildArticleContent, mergeArticleContent } from './article.ts'

const WEEK_START = '2026-07-01T00:00:00.000Z'
const WEEK_END = '2026-07-07T00:00:00.000Z'

/** A valid correlation block: exercise (trigger) against sleep score (outcome), with an optional window. */
const corrBlock = (window: { start?: string; end?: string } = {}): ArticleContent['blocks'][number] => ({
  outcome: { kind: 'metric', metric: 'sleep_score' },
  trigger: { kind: 'activity', pattern: 'exercise' },
  type: 'correlation',
  ...window,
})

const content = (overrides: Partial<ArticleContent> = {}): ArticleContent => ({
  blocks: [],
  default_end: WEEK_END,
  default_start: WEEK_START,
  title: 'A week of HRV',
  ...overrides,
})

describe('blockWindow', () => {
  test('uses the block override when present', () => {
    const win = blockWindow(
      { end: '2026-07-03T00:00:00.000Z', start: '2026-07-02T00:00:00.000Z' },
      { default_end: WEEK_END, default_start: WEEK_START },
    )
    expect(win).toEqual({ end: '2026-07-03T00:00:00.000Z', start: '2026-07-02T00:00:00.000Z' })
  })

  test('falls back to the article default per-edge', () => {
    // Only `start` is overridden; `end` inherits the article default.
    const win = blockWindow(
      { start: '2026-07-02T00:00:00.000Z' },
      { default_end: WEEK_END, default_start: WEEK_START },
    )
    expect(win).toEqual({ end: WEEK_END, start: '2026-07-02T00:00:00.000Z' })
  })
})

describe('buildArticleContent', () => {
  test('accepts prose-only content (no windows needed)', () => {
    const result = buildArticleContent(
      content({
        blocks: [{ markdown: 'Hello', type: 'prose' }],
        default_end: undefined,
        default_start: undefined,
      }),
    )
    expect(result.ok).toBe(true)
  })

  test('accepts a chart block that inherits the article default window', () => {
    const result = buildArticleContent(content({ blocks: [{ metric: 'heart_rate', type: 'chart' }] }))
    expect(result).toEqual({ article: expect.objectContaining({ title: 'A week of HRV' }), ok: true })
  })

  test('accepts a chart block with its own window even without an article default', () => {
    const result = buildArticleContent(
      content({
        blocks: [
          {
            end: '2026-07-02T00:00:00.000Z',
            metric: 'heart_rate',
            start: '2026-07-01T00:00:00.000Z',
            type: 'chart',
          },
        ],
        default_end: undefined,
        default_start: undefined,
      }),
    )
    expect(result.ok).toBe(true)
  })

  test('rejects a chart block with no window and no article default', () => {
    const result = buildArticleContent(
      content({
        blocks: [{ metric: 'heart_rate', type: 'chart' }],
        default_end: undefined,
        default_start: undefined,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no time window')
  })

  test('rejects a chart block whose start is on or after its end', () => {
    const result = buildArticleContent(
      content({
        blocks: [
          {
            end: '2026-07-01T00:00:00.000Z',
            metric: 'heart_rate',
            start: '2026-07-02T00:00:00.000Z',
            type: 'chart',
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('start on or after end')
  })

  test('reports the 1-based index of the offending block', () => {
    const result = buildArticleContent(
      content({
        blocks: [
          { markdown: 'intro', type: 'prose' },
          { metric: 'stress_level', type: 'chart' }, // block 2, no window
        ],
        default_end: undefined,
        default_start: undefined,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Chart block 2')
  })

  test('accepts a correlation block that inherits the article default window', () => {
    const result = buildArticleContent(content({ blocks: [corrBlock()] }))
    expect(result.ok).toBe(true)
  })

  test('accepts a correlation block with its own window even without an article default', () => {
    const result = buildArticleContent(
      content({
        blocks: [corrBlock({ end: '2026-07-02T00:00:00.000Z', start: '2026-07-01T00:00:00.000Z' })],
        default_end: undefined,
        default_start: undefined,
      }),
    )
    expect(result.ok).toBe(true)
  })

  test('rejects a correlation block with no window and no article default', () => {
    const result = buildArticleContent(
      content({ blocks: [corrBlock()], default_end: undefined, default_start: undefined }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Correlation block 1')
      expect(result.error).toContain('no time window')
    }
  })

  test('rejects a correlation block whose start is on or after its end', () => {
    const result = buildArticleContent(
      content({
        blocks: [corrBlock({ end: '2026-07-01T00:00:00.000Z', start: '2026-07-02T00:00:00.000Z' })],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Correlation block 1')
  })
})

describe('mergeArticleContent', () => {
  const existing = content({ blocks: [{ markdown: 'original', type: 'prose' }] })

  test('replaces only the provided fields, keeping the rest', () => {
    const merged = mergeArticleContent(existing, { title: 'Renamed' })
    expect(merged.title).toBe('Renamed')
    expect(merged.blocks).toEqual(existing.blocks)
    expect(merged.default_start).toBe(WEEK_START)
  })

  test('replaces the blocks when provided', () => {
    const merged = mergeArticleContent(existing, { blocks: [{ markdown: 'rewritten', type: 'prose' }] })
    expect(merged.blocks).toEqual([{ markdown: 'rewritten', type: 'prose' }])
    expect(merged.title).toBe(existing.title) // untouched
  })

  test('keeps the existing default window when the patch omits it', () => {
    const merged = mergeArticleContent(existing, { title: 'x' })
    expect(merged.default_start).toBe(WEEK_START)
    expect(merged.default_end).toBe(WEEK_END)
  })
})
