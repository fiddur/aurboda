import type { ArticleDraftContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ArticleDraftRecord, ArticlePostInput, FeedPostRecord } from '../db/index.ts'

import {
  articleDraftPatch,
  type PublishDraftDeps,
  publishableArticle,
  publishArticleDraft,
  serializeArticleDraft,
} from './article-drafts.ts'

const WEEK_START = '2026-07-01T00:00:00.000Z'
const WEEK_END = '2026-07-07T00:00:00.000Z'

const complete = (overrides: Partial<ArticleDraftContent> = {}): ArticleDraftContent => ({
  blocks: [
    { markdown: 'Intro', type: 'prose' },
    { metric: 'heart_rate', type: 'chart' },
  ],
  default_end: WEEK_END,
  default_start: WEEK_START,
  title: 'A week of HRV',
  ...overrides,
})

const draftRecord = (overrides: Partial<ArticleDraftRecord> = {}): ArticleDraftRecord => ({
  article: complete(),
  created_at: new Date('2026-07-08T10:00:00Z'),
  id: 'd1',
  updated_at: new Date('2026-07-08T11:00:00Z'),
  visibility: 'followers',
  ...overrides,
})

/** In-memory deps that record what publishing did. */
const fakeDeps = (draft: ArticleDraftRecord | null, deleteFails = false) => {
  const created: ArticlePostInput[] = []
  const deleted: string[] = []
  const logged: string[] = []
  const deps: PublishDraftDeps = {
    createPost: async (_user, input) => {
      created.push(input)
      return {
        article: input.article,
        id: 'p1',
        kind: 'article',
        visibility: input.visibility,
      } as FeedPostRecord
    },
    deleteDraft: async (_user, id) => {
      if (deleteFails) throw new Error('db down')
      deleted.push(id)
      return true
    },
    getDraft: async (_user, id) => (draft?.id === id ? draft : null),
    logError: (message) => logged.push(message),
  }
  return { created, deleted, deps, logged }
}

describe('serializeArticleDraft', () => {
  test('turns the timestamps into ISO strings', () => {
    expect(serializeArticleDraft(draftRecord())).toEqual({
      article: complete(),
      created_at: '2026-07-08T10:00:00.000Z',
      id: 'd1',
      updated_at: '2026-07-08T11:00:00.000Z',
      visibility: 'followers',
    })
  })
})

describe('articleDraftPatch', () => {
  test('merges only the provided content fields', () => {
    const patch = articleDraftPatch(complete(), { title: 'Renamed' })
    expect(patch).toEqual({ article: complete({ title: 'Renamed' }) })
  })

  test('a visibility-only update leaves the content alone', () => {
    expect(articleDraftPatch(complete(), { visibility: 'unlisted' })).toEqual({ visibility: 'unlisted' })
  })

  test('null clears a default window bound; omitted keeps it', () => {
    expect(articleDraftPatch(complete(), { default_start: null }).article).toEqual(
      complete({ default_start: undefined }),
    )
    const cleared = articleDraftPatch(complete(), { default_end: null, default_start: null }).article
    expect(cleared).not.toHaveProperty('default_start')
    expect(cleared).not.toHaveProperty('default_end')
    expect(articleDraftPatch(complete(), { title: 'x' }).article?.default_start).toBe(WEEK_START)
  })

  test('a new default window bound replaces the stored one', () => {
    const later = '2026-07-02T00:00:00.000Z'
    expect(articleDraftPatch(complete(), { default_start: later }).article?.default_start).toBe(later)
  })

  test('an empty title is a valid replacement in a draft', () => {
    expect(articleDraftPatch(complete(), { title: '' }).article?.title).toBe('')
  })
})

describe('publishableArticle', () => {
  test('a complete draft becomes the article post input', () => {
    const result = publishableArticle(complete(), 'public')
    expect(result).toEqual({ input: { article: complete(), visibility: 'public' }, ok: true })
  })

  test('rejects a missing title', () => {
    expect(publishableArticle(complete({ title: '  ' }), 'public')).toEqual({
      error: 'Give the article a title before publishing.',
      ok: false,
    })
  })

  test('rejects a chart without a metric', () => {
    const result = publishableArticle(complete({ blocks: [{ type: 'chart' }] }), 'public')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('Chart block 1 has no metric')
  })

  test('rejects a correlation without trigger or outcome', () => {
    const result = publishableArticle(
      complete({ blocks: [{ trigger: { kind: 'activity', pattern: 'run' }, type: 'correlation' }] }),
      'public',
    )
    expect(!result.ok && result.error).toContain('Correlation block 1 needs both a trigger and an outcome')
  })

  test('applies the same window validation as publishing directly', () => {
    const result = publishableArticle(
      complete({ default_end: undefined, default_start: undefined }),
      'public',
    )
    expect(!result.ok && result.error).toContain('no time window')
  })
})

describe('publishArticleDraft', () => {
  test('creates the post with the draft visibility, then deletes the draft', async () => {
    const fake = fakeDeps(draftRecord())
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result.ok && result.post.id).toBe('p1')
    expect(fake.created).toEqual([{ article: complete(), visibility: 'followers' }])
    expect(fake.deleted).toEqual(['d1'])
  })

  test('the publish body overrides the draft visibility', async () => {
    const fake = fakeDeps(draftRecord())
    await publishArticleDraft('alice', 'd1', { visibility: 'unlisted' }, fake.deps)
    expect(fake.created[0].visibility).toBe('unlisted')
  })

  test('an invalid draft is a 400 and is kept', async () => {
    const fake = fakeDeps(draftRecord({ article: complete({ title: '' }) }))
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result).toEqual({ error: 'Give the article a title before publishing.', ok: false, status: 400 })
    expect(fake.created).toEqual([])
    expect(fake.deleted).toEqual([])
  })

  test('an unknown draft is a 404', async () => {
    const fake = fakeDeps(null)
    expect(await publishArticleDraft('alice', 'd1', {}, fake.deps)).toEqual({
      error: 'Draft not found',
      ok: false,
      status: 404,
    })
  })

  test('a failed delete after publishing is logged, and the post still stands', async () => {
    const fake = fakeDeps(draftRecord(), true)
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result.ok).toBe(true)
    expect(fake.logged).toHaveLength(1)
  })
})
