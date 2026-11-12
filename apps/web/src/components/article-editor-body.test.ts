import type { ArticleBlock, ArticleDraft, FeedPost } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  type ArticleEditorState,
  blocksStillUploading,
  buildArticleBody,
  buildDraftContent,
  buildPreviewArticle,
  challengePickerOptions,
  deriveSubmitError,
  draftSnapshot,
  draftsFromPost,
  draftUpdateBody,
  emptyChallengeDraft,
  emptyCorrelationDraft,
  emptyImpactDraft,
  impactPickerOptions,
  initialArticleEditorState,
  parseImpactOptionValue,
  previewRequest,
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

describe('buildDraftContent', () => {
  it('keeps an incomplete article: no title, no chart metric, empty selectors', () => {
    const content = buildDraftContent(
      state({
        blocks: [
          { markdown: 'half a thought', type: 'prose' },
          { bucket: '', caption: '  ', end: '', metric: '', start: '', type: 'chart' },
          emptyCorrelationDraft(),
        ],
        title: '  ',
      }),
    )
    expect(content).toEqual({
      blocks: [
        { markdown: 'half a thought', type: 'prose' },
        { type: 'chart' },
        {
          outcome: { kind: 'metric', metric: '' },
          trigger: { kind: 'activity', pattern: '' },
          type: 'correlation',
        },
      ],
      title: '',
    })
  })

  it('carries windows, bucket, caption and a whole-number lag', () => {
    const iso = '2026-07-01T00:00:00.000Z'
    const local = toInputValue(iso)
    const content = buildDraftContent(
      state({
        blocks: [
          {
            bucket: '1h',
            caption: ' Resting HR ',
            end: local,
            metric: 'heart_rate',
            start: local,
            type: 'chart',
          },
          { ...emptyCorrelationDraft(), lagDays: '2' },
          { ...emptyCorrelationDraft(), lagDays: '1.5' },
        ],
        defaultEnd: local,
        defaultStart: local,
      }),
    )
    expect(content.default_start).toBe(iso)
    expect(content.default_end).toBe(iso)
    expect(content.blocks[0]).toEqual({
      bucket: '1h',
      caption: 'Resting HR',
      end: iso,
      metric: 'heart_rate',
      start: iso,
      type: 'chart',
    })
    expect(content.blocks[1]).toMatchObject({ lag_days: 2 })
    expect(content.blocks[2]).not.toHaveProperty('lag_days')
  })

  it('drops a metric that cannot be charted', () => {
    const content = buildDraftContent(
      state({
        blocks: [{ bucket: '', caption: '', end: '', metric: 'my_custom', start: '', type: 'chart' }],
      }),
    )
    expect(content.blocks[0]).toEqual({ type: 'chart' })
  })
})

describe('challenge blocks', () => {
  const URL_ = 'https://aurboda.example/u/olle/nov'

  it('a draft keeps an unchosen challenge, and carries a chosen one with its caption', () => {
    const content = buildDraftContent(
      state({
        blocks: [emptyChallengeDraft(), { caption: ' Join! ', type: 'challenge', url: ` ${URL_} ` }],
      }),
    )
    expect(content.blocks).toEqual([
      { type: 'challenge' },
      { caption: 'Join!', challenge_url: URL_, type: 'challenge' },
    ])
  })

  it('seeds the editor from a stored challenge block, and from a draft without a URL', () => {
    const drafts = draftsFromPost({
      article: {
        blocks: [{ caption: 'Race', challenge_url: URL_, type: 'challenge' }, { type: 'challenge' }],
        title: 'T',
      },
    })
    expect(drafts).toEqual([
      { caption: 'Race', type: 'challenge', url: URL_ },
      { caption: '', type: 'challenge', url: '' },
    ])
  })

  it('publishing needs a challenge', () => {
    expect(buildArticleBody(state({ blocks: [emptyChallengeDraft()] }))).toEqual({
      error: 'Pick a challenge or paste its link for challenge block 1.',
      ok: false,
    })
  })

  it('offers own challenges by share URL and active joined ones by challenge URL, each once', () => {
    const options = challengePickerOptions(
      [{ name: 'Mine', share_url: URL_ }],
      [
        { challenge_url: 'https://other.example/u/eva/oct', name: 'Eva’s', status: 'active' },
        { challenge_url: 'https://other.example/u/eva/left', name: 'Left', status: 'withdrawn' },
        { challenge_url: URL_, name: 'Mine again', status: 'active' },
      ],
    )
    expect(options).toEqual({
      joined: [{ label: 'Eva’s', url: 'https://other.example/u/eva/oct' }],
      own: [{ label: 'Mine', url: URL_ }],
    })
  })

  it('publishes a chosen challenge', () => {
    const result = buildArticleBody(state({ blocks: [{ caption: '', type: 'challenge', url: URL_ }] }))
    expect(result.ok && result.body.blocks).toEqual([{ challenge_url: URL_, type: 'challenge' }])
  })
})

describe('impact blocks', () => {
  const WINDOW = { end: '2026-07-07T00:00:00.000Z', start: '2026-07-01T00:00:00.000Z' }

  it('round-trips a stored impact block through the editor', () => {
    const stored = {
      activity: 'yoga',
      activity_type: 'activity_type' as const,
      caption: 'Morning yoga',
      ...WINDOW,
      type: 'impact' as const,
      window_minutes: 120,
    }
    const drafts = draftsFromPost({ article: { blocks: [stored], title: 'T' } })
    expect(drafts).toEqual([
      {
        activity: 'yoga',
        activityType: 'activity_type',
        caption: 'Morning yoga',
        end: toInputValue(WINDOW.end),
        start: toInputValue(WINDOW.start),
        type: 'impact',
        windowMinutes: 120,
      },
    ])
    expect(buildDraftContent(state({ blocks: drafts })).blocks).toEqual([stored])
    const result = buildArticleBody(state({ blocks: drafts }))
    expect(result.ok && result.body.blocks).toEqual([stored])
  })

  it('seeds a draft block without an activity, defaulting the window to 30 minutes', () => {
    const drafts = draftsFromPost({
      article: { blocks: [{ activity_type: 'location', type: 'impact' }], title: 'T' },
    })
    expect(drafts).toEqual([{ ...emptyImpactDraft(), activityType: 'location' }])
  })

  it('a draft keeps an unchosen activity; publishing needs one', () => {
    expect(buildDraftContent(state({ blocks: [emptyImpactDraft()] })).blocks).toEqual([
      { activity_type: 'activity_type', type: 'impact', window_minutes: 30 },
    ])
    expect(buildArticleBody(state({ blocks: [emptyImpactDraft()] }))).toEqual({
      error: 'Pick an activity for impact block 1.',
      ok: false,
    })
  })

  const correlations = {
    activities: [{ activity_type: 'yoga' }, { activity_type: 'running' }],
    locations: [{ location_name: 'Gym' }],
    productivity: [],
  }

  it('groups the picker like the Analyze context table, leaving out empty groups', () => {
    const { extra, groups } = impactPickerOptions(correlations, emptyImpactDraft())
    expect(extra).toBeNull()
    expect(groups.map((g) => g.label)).toEqual(['Activities', 'Locations'])
    expect(groups[0].options.map((o) => [o.activityType, o.activity])).toEqual([
      ['activity_type', 'yoga'],
      ['activity_type', 'running'],
    ])
    expect(groups[1].options[0]).toMatchObject({ activity: 'Gym', activityType: 'location' })
  })

  it('an option value names both the type and the activity', () => {
    const { groups } = impactPickerOptions(correlations, emptyImpactDraft())
    expect(parseImpactOptionValue(groups[1].options[0].value)).toEqual({
      activity: 'Gym',
      activityType: 'location',
    })
    expect(parseImpactOptionValue('')).toBeNull()
  })

  it('keeps a stored pair the list lacks as one extra option', () => {
    const listed = impactPickerOptions(correlations, { activity: 'yoga', activityType: 'activity_type' })
    expect(listed.extra).toBeNull()
    const sameNameOtherType = impactPickerOptions(correlations, { activity: 'yoga', activityType: 'tag' })
    expect(sameNameOtherType.extra).toMatchObject({ activity: 'yoga', activityType: 'tag' })
    expect(impactPickerOptions(undefined, { activity: 'coffee', activityType: 'tag' })).toMatchObject({
      extra: { activity: 'coffee', activityType: 'tag' },
      groups: [],
    })
  })
})

describe('initialArticleEditorState', () => {
  it('starts empty and public with nothing to open', () => {
    expect(initialArticleEditorState()).toEqual(state({ title: '' }))
  })

  it('opens a draft, filling unset chart metrics and selectors with empty editor values', () => {
    const draft: ArticleDraft = {
      article: {
        blocks: [{ type: 'chart' }, { outcome: { kind: 'metric', metric: 'hrv' }, type: 'correlation' }],
        default_start: '2026-07-01T00:00:00.000Z',
        title: '',
      },
      created_at: '2026-07-08T10:00:00.000Z',
      id: 'd1',
      updated_at: '2026-07-08T11:00:00.000Z',
      visibility: 'followers',
    }
    const initial = initialArticleEditorState(draft)
    expect(initial.title).toBe('')
    expect(initial.visibility).toBe('followers')
    expect(initial.defaultStart).toBe(toInputValue('2026-07-01T00:00:00.000Z'))
    expect(initial.blocks).toEqual([
      { bucket: '', caption: '', end: '', metric: '', start: '', type: 'chart' },
      { ...emptyCorrelationDraft(), outcome: { kind: 'metric', metric: 'hrv' } },
    ])
  })

  it('round-trips a saved draft without registering a change', () => {
    const edited = state({
      blocks: [
        { markdown: 'intro', type: 'prose' },
        { bucket: '', caption: '', end: '', metric: 'heart_rate', start: '', type: 'chart' },
      ],
      visibility: 'unlisted',
    })
    const reopened = initialArticleEditorState({ article: buildDraftContent(edited), visibility: 'unlisted' })
    expect(draftSnapshot(reopened)).toBe(draftSnapshot(edited))
  })

  it("keeps a draft's explicit tags, and none when it has none", () => {
    const tagged = initialArticleEditorState({
      article: { blocks: [], tags: ['hrv'], title: 'T' },
      visibility: 'public',
    })
    expect(tagged.tags).toEqual(['hrv'])
    expect(buildDraftContent(tagged).tags).toEqual(['hrv'])
    expect(
      initialArticleEditorState({ article: { blocks: [], title: 'T' }, visibility: 'public' }),
    ).not.toHaveProperty('tags')
  })
})

describe('draftSnapshot', () => {
  it('changes when the content or the audience does', () => {
    const base = draftSnapshot(state())
    expect(draftSnapshot(state({ title: 'Other' }))).not.toBe(base)
    expect(draftSnapshot(state({ tags: ['hrv'] }))).not.toBe(base)
    expect(draftSnapshot(state({ visibility: 'followers' }))).not.toBe(base)
    expect(draftSnapshot(state())).toBe(base)
  })
})

describe('draftUpdateBody', () => {
  it('sends null for an emptied default window so the server clears it', () => {
    const body = draftUpdateBody(state({ defaultEnd: '', defaultStart: '', visibility: 'unlisted' }))
    expect(body).toEqual({
      blocks: [],
      default_end: null,
      default_start: null,
      tags: null,
      title: 'A week of HRV',
      visibility: 'unlisted',
    })
  })

  it('sends explicit tags, and null for the automatic ones', () => {
    expect(draftUpdateBody(state({ tags: ['hrv'] })).tags).toEqual(['hrv'])
    expect(draftUpdateBody(state({ tags: [] })).tags).toEqual([])
  })

  it('sends a set default window as ISO', () => {
    const iso = '2026-07-01T00:00:00.000Z'
    const local = toInputValue(iso)
    const body = draftUpdateBody(state({ defaultEnd: local, defaultStart: local }))
    expect(body.default_start).toBe(iso)
    expect(body.default_end).toBe(iso)
  })
})

describe('article tags', () => {
  it('publishes explicit tags only', () => {
    const tagged = buildArticleBody(state({ tags: ['hrv', 'sleep'] }))
    expect(tagged.ok && tagged.body.tags).toEqual(['hrv', 'sleep'])
    const automatic = buildArticleBody(state())
    expect(automatic.ok && automatic.body).not.toHaveProperty('tags')
  })
})

describe('buildPreviewArticle', () => {
  const chart = {
    bucket: '',
    caption: 'Pulse',
    end: '',
    metric: 'heart_rate',
    start: '',
    type: 'chart',
  } as const
  const windowed = { defaultEnd: '2026-07-07T00:00', defaultStart: '2026-07-01T00:00' }

  it('keeps only complete blocks, windows as ISO', () => {
    const article = buildPreviewArticle(
      state({
        ...windowed,
        blocks: [
          { markdown: 'Morning coffee', type: 'prose' },
          { ...chart, metric: '' },
          chart,
          emptyCorrelationDraft(),
          {
            ...emptyCorrelationDraft(),
            outcome: { kind: 'metric', metric: 'hrv' },
            trigger: { kind: 'activity', pattern: 'yoga' },
          },
          { ...emptyChallengeDraft(), url: 'https://ex.example/not-one' },
          { ...emptyChallengeDraft(), url: 'https://ex.example/u/alice/running-may' },
          emptyImpactDraft(),
          { ...emptyImpactDraft(), activity: 'meditation' },
          { ...chart, end: '2026-06-01T00:00' },
        ],
      }),
    )
    expect(article.blocks.map((b) => b.type)).toEqual([
      'prose',
      'chart',
      'correlation',
      'challenge',
      'impact',
    ])
    expect(article.default_start).toBe(toIso(windowed.defaultStart))
    expect(article.default_end).toBe(toIso(windowed.defaultEnd))
  })

  it('drops windowed blocks without a window and titles a blank article', () => {
    const article = buildPreviewArticle(state({ blocks: [chart], title: '  ' }))
    expect(article).toEqual({ blocks: [], title: 'Untitled' })
  })
})

describe('previewRequest', () => {
  it('sends the draft content, the visibility and asks for the images', () => {
    const s = state({
      blocks: [{ markdown: 'Yoga', type: 'prose' }],
      tags: ['yoga'],
      visibility: 'followers',
    })
    expect(previewRequest(s)).toEqual({
      article: buildDraftContent(s),
      include_images: true,
      visibility: 'followers',
    })
  })
})

describe('blocksStillUploading', () => {
  it('holds while any prose block has a picture placeholder', () => {
    expect(
      blocksStillUploading([
        { markdown: 'Morning coffee', type: 'prose' },
        { markdown: 'Yoga\n![Uploading mat.jpg…]()\n', type: 'prose' },
      ]),
    ).toBe(true)
  })

  it('does not hold once every picture is in, or with no prose at all', () => {
    expect(
      blocksStillUploading([
        { markdown: '![](https://aurboda.test/api/public/alice/images/x.webp)', type: 'prose' },
        emptyChallengeDraft(),
      ]),
    ).toBe(false)
    expect(blocksStillUploading([])).toBe(false)
  })
})
