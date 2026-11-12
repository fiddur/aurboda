import type { ArticleContent } from '@aurboda/api-spec'

import { articleBlockSchema, articleDraftBlockSchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import {
  articleBlockFigureUrl,
  articleBlockImageUrl,
  articleBlockLabel,
  blockWindow,
  buildArticleContent,
  checkArticleChallenges,
  isZeroDurationBucket,
  mergeArticleContent,
  validateArticleContent,
  withCanonicalChallengeUrls,
} from './article.ts'

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

describe('impact blocks', () => {
  const impact = (over: Record<string, unknown> = {}): ArticleContent['blocks'][number] => ({
    activity: 'yoga',
    activity_type: 'activity_type',
    type: 'impact',
    ...over,
  })

  test('the schema takes one exact activity and a 10 to 1440 minute window', () => {
    expect(articleBlockSchema.safeParse(impact({ window_minutes: 120 })).success).toBe(true)
    expect(articleBlockSchema.safeParse(impact({ activity: '' })).success).toBe(false)
    expect(articleBlockSchema.safeParse(impact({ activity: undefined })).success).toBe(false)
    expect(articleBlockSchema.safeParse(impact({ window_minutes: 5 })).success).toBe(false)
    expect(articleBlockSchema.safeParse(impact({ window_minutes: 2000 })).success).toBe(false)
    expect(articleBlockSchema.safeParse(impact({ activity_type: 'mood' })).success).toBe(false)
  })

  test('a draft may leave the activity unset', () => {
    expect(articleDraftBlockSchema.safeParse(impact({ activity: undefined })).success).toBe(true)
  })

  test('labels an impact block by its caption, else by its activity', () => {
    expect(articleBlockLabel({ activity: 'yoga', activity_type: 'activity_type', type: 'impact' })).toBe(
      'Impact of yoga',
    )
    expect(
      articleBlockLabel({
        activity: 'yoga',
        activity_type: 'activity_type',
        caption: 'Calm',
        type: 'impact',
      }),
    ).toBe('Calm')
  })

  test('accepts an impact block that inherits the article default window', () => {
    expect(buildArticleContent(content({ blocks: [impact()] })).ok).toBe(true)
  })

  test('rejects an impact block with no window and no article default', () => {
    const result = buildArticleContent(
      content({ blocks: [impact()], default_end: undefined, default_start: undefined }),
    )
    expect(result).toEqual({
      error:
        'Impact block 1 (yoga) has no time window — set its start/end or an article default_start/default_end.',
      ok: false,
    })
  })

  test('rejects an impact block whose start is on or after its end', () => {
    const result = buildArticleContent(
      content({ blocks: [impact({ end: '2026-07-01T00:00:00.000Z', start: '2026-07-02T00:00:00.000Z' })] }),
    )
    expect(result).toEqual({ error: 'Impact block 1 (yoga) has start on or after end.', ok: false })
  })
})

describe('challenge blocks', () => {
  const challenge = (challenge_url: string): ArticleContent['blocks'][number] => ({
    challenge_url,
    type: 'challenge',
  })
  const noWindow = { default_end: undefined, default_start: undefined }

  test('a challenge block needs no window', () => {
    const result = buildArticleContent(
      content({ blocks: [challenge('https://qs.example/u/freja/nov')], ...noWindow }),
    )
    expect(result.ok).toBe(true)
  })

  test('rejects a URL that is not a challenge link', () => {
    const result = buildArticleContent(
      content({ blocks: [{ markdown: 'Hi', type: 'prose' }, challenge('https://qs.example/about')] }),
    )
    expect(result).toEqual({ error: 'Block 2: not a challenge URL.', ok: false })
  })

  test('rejects a challenge-shaped URL that is not http(s)', () => {
    const result = buildArticleContent(content({ blocks: [challenge('javascript://x/u/a/b')] }))
    expect(result).toEqual({ error: 'Block 1: not a challenge URL.', ok: false })
  })

  test('labels a challenge block by its caption, else as standings', () => {
    expect(articleBlockLabel({ challenge_url: 'https://qs.example/u/a/b', type: 'challenge' })).toBe(
      'Challenge standings',
    )
    expect(
      articleBlockLabel({ caption: 'Join us', challenge_url: 'https://qs.example/u/a/b', type: 'challenge' }),
    ).toBe('Join us')
  })

  const lookup = (found: boolean | Error) => ({
    getChallengeBySlug: vi.fn(async () => {
      if (found instanceof Error) throw found
      return found ? { id: 'c1' } : null
    }),
    webHost: 'https://qs.example/',
  })

  test('accepts a local challenge that exists', async () => {
    const deps = lookup(true)
    const result = await checkArticleChallenges(
      content({ blocks: [challenge('https://qs.example/u/olle/nov')] }),
      deps,
    )
    expect(result.ok).toBe(true)
    expect(deps.getChallengeBySlug).toHaveBeenCalledWith('olle', 'nov')
  })

  test('rejects a local challenge that does not exist', async () => {
    const result = await checkArticleChallenges(
      content({ blocks: [challenge('https://qs.example/u/olle/nov')] }),
      lookup(false),
    )
    expect(result).toEqual({ error: 'Block 1: challenge not found.', ok: false })
  })

  test('a local user without a database counts as missing', async () => {
    const missing = Object.assign(new Error('no db'), { code: '3D000' })
    const result = await checkArticleChallenges(
      content({ blocks: [challenge('https://qs.example/u/nobody/nov')] }),
      lookup(missing),
    )
    expect(result).toEqual({ error: 'Block 1: challenge not found.', ok: false })
  })

  test('a remote challenge is accepted without a lookup', async () => {
    const deps = lookup(false)
    const result = await checkArticleChallenges(
      content({ blocks: [challenge('https://other.example/u/olle/oct')] }),
      deps,
    )
    expect(result.ok).toBe(true)
    expect(deps.getChallengeBySlug).not.toHaveBeenCalled()
  })

  test('nothing is checked without a lookup', async () => {
    const result = await checkArticleChallenges(
      content({ blocks: [challenge('https://qs.example/u/olle/nov')] }),
      null,
    )
    expect(result.ok).toBe(true)
  })

  test('stores a challenge URL in its canonical spelling', () => {
    const result = buildArticleContent(
      content({ blocks: [challenge('HTTPS://QS.Example:443/u/olle/nov/?ref=x#frag')] }),
    )
    expect(result).toEqual({
      article: content({ blocks: [challenge('https://qs.example/u/olle/nov')] }),
      ok: true,
    })
  })

  test('canonicalises only challenge blocks that carry a URL', () => {
    const blocks = [{ markdown: 'Hi', type: 'prose' as const }, { type: 'challenge' as const }]
    expect(withCanonicalChallengeUrls(blocks)).toEqual(blocks)
  })

  test('an edit keeps a block whose challenge was deleted since', async () => {
    const stored = content({ blocks: [challenge('https://qs.example/u/olle/nov?ref=x')], title: 'Old' })
    const deps = lookup(false)
    const result = await validateArticleContent(mergeArticleContent(stored, { title: 'Fixed typo' }), {
      lookup: deps,
      stored,
    })
    expect(result).toEqual({
      article: content({ blocks: [challenge('https://qs.example/u/olle/nov')], title: 'Fixed typo' }),
      ok: true,
    })
    expect(deps.getChallengeBySlug).not.toHaveBeenCalled()
  })

  test('an edit that adds an unknown local challenge still fails', async () => {
    const stored = content({ blocks: [challenge('https://qs.example/u/olle/nov')] })
    const deps = lookup(false)
    const result = await validateArticleContent(
      mergeArticleContent(stored, {
        blocks: [...stored.blocks, challenge('https://qs.example/u/olle/dec')],
      }),
      { lookup: deps, stored },
    )
    expect(result).toEqual({ error: 'Block 2: challenge not found.', ok: false })
    expect(deps.getChallengeBySlug).toHaveBeenCalledTimes(1)
    expect(deps.getChallengeBySlug).toHaveBeenCalledWith('olle', 'dec')
  })

  test('without a stored article every block is checked', async () => {
    const result = await validateArticleContent(
      content({ blocks: [challenge('https://qs.example/u/olle/nov')] }),
      { lookup: lookup(false) },
    )
    expect(result).toEqual({ error: 'Block 1: challenge not found.', ok: false })
  })
})

describe('isZeroDurationBucket', () => {
  test('flags zero-duration buckets in any unit', () => {
    expect(isZeroDurationBucket('0s')).toBe(true)
    expect(isZeroDurationBucket('00m')).toBe(true)
    expect(isZeroDurationBucket('0h')).toBe(true)
    expect(isZeroDurationBucket('0d')).toBe(true)
  })

  test('accepts a normal bucket', () => {
    expect(isZeroDurationBucket('5s')).toBe(false)
    expect(isZeroDurationBucket('1h')).toBe(false)
  })
})

describe('articleBlockImageUrl', () => {
  const UPDATED = new Date('2026-07-09T00:00:00Z')
  const V = String(UPDATED.getTime())
  const base = 'https://aurboda.example/api/public/fiddur/feed/POST'

  test('no token for a public/unlisted post', () => {
    expect(
      articleBlockImageUrl('https://aurboda.example/api', 'fiddur', 'POST', 'public', 'secret', UPDATED, 0),
    ).toBe(`${base}/blocks/0/image.png?v=${V}`)
  })

  test('carries the capability token for a followers-only post', () => {
    expect(
      articleBlockImageUrl(
        'https://aurboda.example/api',
        'fiddur',
        'POST',
        'followers',
        'secret',
        UPDATED,
        2,
      ),
    ).toBe(`${base}/blocks/2/image.png?v=${V}&token=secret`)
  })

  test('supports the svg format', () => {
    expect(
      articleBlockImageUrl(
        'https://aurboda.example/api',
        'fiddur',
        'POST',
        'public',
        'secret',
        UPDATED,
        1,
        'svg',
      ),
    ).toBe(`${base}/blocks/1/image.svg?v=${V}`)
  })
})

describe('articleBlockFigureUrl', () => {
  const UPDATED = new Date('2026-07-09T00:00:00Z')
  const V = String(UPDATED.getTime())
  const base = 'https://aurboda.example/api/public/fiddur/feed/POST'

  test('points at figure.png, versioned, with the token only when not public', () => {
    expect(
      articleBlockFigureUrl(
        'https://aurboda.example/api/',
        'fiddur',
        'POST',
        'unlisted',
        'secret',
        UPDATED,
        3,
      ),
    ).toBe(`${base}/blocks/3/figure.png?v=${V}`)
    expect(
      articleBlockFigureUrl(
        'https://aurboda.example/api',
        'fiddur',
        'POST',
        'followers',
        'secret',
        UPDATED,
        0,
      ),
    ).toBe(`${base}/blocks/0/figure.png?v=${V}&token=secret`)
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
