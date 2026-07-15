import type { ArticleBlock, FeedPost } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  type ArticleEditorState,
  buildArticleBody,
  deriveSubmitError,
  draftsFromPost,
  emptyCorrelationDraft,
  toInputValue,
  toIso,
} from './article-editor-body'

const state = (overrides: Partial<ArticleEditorState> = {}): ArticleEditorState => ({
  blocks: [],
  defaultEnd: '',
  defaultStart: '',
  title: 'A week of HRV',
  visibility: 'public',
  ...overrides,
})

describe('toInputValue / toIso', () => {
  it('returns empty for a missing ISO and blank input', () => {
    expect(toInputValue(undefined)).toBe('')
    expect(toIso('')).toBeUndefined()
  })

  it('round-trips an instant on a minute boundary (timezone-independent)', () => {
    const iso = '2026-07-01T00:00:00.000Z'
    // local datetime-local → back to ISO preserves the instant (seconds dropped).
    expect(toIso(toInputValue(iso))).toBe(iso)
  })
})

describe('buildArticleBody', () => {
  it('rejects an empty title', () => {
    const result = buildArticleBody(state({ title: '   ' }))
    expect(result).toEqual({ error: 'Give your article a title.', ok: false })
  })

  it('builds a prose block and trims the title', () => {
    const result = buildArticleBody(
      state({ blocks: [{ markdown: 'Hello', type: 'prose' }], title: '  Titled  ' }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body.title).toBe('Titled')
      expect(result.body.blocks).toEqual([{ markdown: 'Hello', type: 'prose' }])
    }
  })

  it('prompts to pick a metric when a chart block has none', () => {
    const result = buildArticleBody(
      state({ blocks: [{ bucket: '', caption: '', end: '', metric: '', start: '', type: 'chart' }] }),
    )
    expect(result).toEqual({ error: 'Pick a metric for chart block 1.', ok: false })
  })

  it('rejects an unsupported (custom) metric with a clear message', () => {
    const result = buildArticleBody(
      state({
        blocks: [{ bucket: '', caption: '', end: '', metric: 'my_custom_metric', start: '', type: 'chart' }],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('my_custom_metric')
      expect(result.error).toContain("custom metrics aren't supported")
    }
  })

  it('omits empty optional fields on a chart block', () => {
    const result = buildArticleBody(
      state({
        blocks: [{ bucket: '', caption: '  ', end: '', metric: 'heart_rate', start: '', type: 'chart' }],
      }),
    )
    expect(result.ok).toBe(true)
    // No window/bucket/caption keys when they were blank.
    if (result.ok) expect(result.body.blocks[0]).toEqual({ metric: 'heart_rate', type: 'chart' })
  })

  it('includes a chart caption and the article default window when set', () => {
    const result = buildArticleBody(
      state({
        blocks: [
          { bucket: '1h', caption: 'Resting HR', end: '', metric: 'heart_rate', start: '', type: 'chart' },
        ],
        defaultEnd: toInputValue('2026-07-07T00:00:00.000Z'),
        defaultStart: toInputValue('2026-07-01T00:00:00.000Z'),
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body.default_start).toBe('2026-07-01T00:00:00.000Z')
      expect(result.body.default_end).toBe('2026-07-07T00:00:00.000Z')
      expect(result.body.blocks[0]).toEqual({
        bucket: '1h',
        caption: 'Resting HR',
        metric: 'heart_rate',
        type: 'chart',
      })
    }
  })
})

describe('deriveSubmitError', () => {
  it('prefers a form-validation error', () => {
    expect(deriveSubmitError('Give it a title.', new Error('boom'))).toBe('Give it a title.')
  })

  it('surfaces a real mutation error but ignores the internal validation rejection', () => {
    expect(deriveSubmitError(null, new Error('Server said no'))).toBe('Server said no')
    expect(deriveSubmitError(null, new Error('validation'))).toBeNull()
    expect(deriveSubmitError(null, null)).toBeNull()
  })
})

const correlationBlock: Extract<ArticleBlock, { type: 'correlation' }> = {
  caption: 'HRV vs training',
  end: '2026-07-07T00:00:00.000Z',
  lag_days: 1,
  outcome: { kind: 'metric', metric: 'sleep_score' },
  start: '2026-07-01T00:00:00.000Z',
  trigger: { kind: 'activity', pattern: 'exercise' },
  type: 'correlation',
}

const completeCorrelationDraft = () => ({
  ...emptyCorrelationDraft(),
  outcome: { kind: 'metric' as const, metric: 'sleep_score' },
  trigger: { kind: 'activity' as const, pattern: 'exercise' },
})

describe('correlation drafts', () => {
  it('seeds an editable draft from a stored correlation block', () => {
    const post = { article: { blocks: [correlationBlock], title: 'T' }, kind: 'article' } as FeedPost
    expect(draftsFromPost(post)).toEqual([
      {
        caption: 'HRV vs training',
        end: toInputValue('2026-07-07T00:00:00.000Z'),
        lagDays: '1',
        outcome: { kind: 'metric', metric: 'sleep_score' },
        start: toInputValue('2026-07-01T00:00:00.000Z'),
        trigger: { kind: 'activity', pattern: 'exercise' },
        type: 'correlation',
      },
    ])
  })

  it('round-trips a stored correlation block through seed → build (lossless)', () => {
    const post = { article: { blocks: [correlationBlock], title: 'T' }, kind: 'article' } as FeedPost
    const result = buildArticleBody(state({ blocks: draftsFromPost(post) }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.body.blocks[0]).toEqual(correlationBlock)
  })

  it('rejects a correlation block with an unfilled trigger', () => {
    const result = buildArticleBody(state({ blocks: [emptyCorrelationDraft()] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('trigger')
  })

  it('rejects a non-integer lag (caught early, not left to the server)', () => {
    const result = buildArticleBody(state({ blocks: [{ ...completeCorrelationDraft(), lagDays: '1.5' }] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('whole number')
  })

  it('keeps an integer lag on the built block', () => {
    const result = buildArticleBody(state({ blocks: [{ ...completeCorrelationDraft(), lagDays: '2' }] }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.body.blocks[0]).toMatchObject({ lag_days: 2 })
  })

  it('omits empty optional fields (no window / lag / caption)', () => {
    const result = buildArticleBody(state({ blocks: [completeCorrelationDraft()] }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body.blocks[0]).toEqual({
        outcome: { kind: 'metric', metric: 'sleep_score' },
        trigger: { kind: 'activity', pattern: 'exercise' },
        type: 'correlation',
      })
    }
  })
})

describe('draftsFromPost', () => {
  it('returns no drafts for a non-article post', () => {
    expect(draftsFromPost(undefined)).toEqual([])
    expect(draftsFromPost({ kind: 'activity' } as FeedPost)).toEqual([])
  })

  it('seeds drafts from a stored article, defaulting optional chart fields to empty strings', () => {
    const post = {
      article: {
        blocks: [
          { markdown: 'intro', type: 'prose' },
          { metric: 'heart_rate', type: 'chart' }, // no window/bucket/caption
        ],
        title: 'T',
      },
      kind: 'article',
    } as FeedPost
    const drafts = draftsFromPost(post)
    expect(drafts[0]).toEqual({ markdown: 'intro', type: 'prose' })
    expect(drafts[1]).toEqual({
      bucket: '',
      caption: '',
      end: '',
      metric: 'heart_rate',
      start: '',
      type: 'chart',
    })
  })
})
