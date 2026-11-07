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

/** In-memory deps over one draft store, recording what publishing did. */
const fakeDeps = (draft: ArticleDraftRecord | null, { createFails = false, restoreFails = false } = {}) => {
  const drafts = new Map<string, ArticleDraftRecord>(draft ? [[draft.id, draft]] : [])
  const created: ArticlePostInput[] = []
  const claimed: string[] = []
  const logged: string[] = []
  const deps: PublishDraftDeps = {
    claimDraft: async (_user, id) => {
      const found = drafts.get(id) ?? null
      drafts.delete(id)
      if (found) claimed.push(id)
      return found
    },
    createPost: async (_user, input) => {
      if (createFails) throw new Error('db down')
      created.push(input)
      return {
        article: input.article,
        id: `p${created.length}`,
        kind: 'article',
        visibility: input.visibility,
      } as FeedPostRecord
    },
    getDraft: async (_user, id) => drafts.get(id) ?? null,
    logError: (message) => logged.push(message),
    postTags: async () => ['aurboda'],
    restoreDraft: async (_user, record) => {
      if (restoreFails) throw new Error('db down')
      drafts.set(record.id, record)
    },
  }
  return { claimed, created, deps, drafts, logged }
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
  test('creates the post with the draft visibility, and the draft is gone', async () => {
    const fake = fakeDeps(draftRecord())
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result.ok && result.post.id).toBe('p1')
    expect(fake.created).toEqual([{ article: complete(), tags: ['aurboda'], visibility: 'followers' }])
    expect(fake.claimed).toEqual(['d1'])
    expect(fake.drafts.size).toBe(0)
  })

  test('the publish body overrides the draft visibility', async () => {
    const fake = fakeDeps(draftRecord())
    await publishArticleDraft('alice', 'd1', { visibility: 'unlisted' }, fake.deps)
    expect(fake.created[0].visibility).toBe('unlisted')
  })

  test('an invalid draft is a 400 and is never claimed', async () => {
    const fake = fakeDeps(draftRecord({ article: complete({ title: '' }) }))
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result).toEqual({ error: 'Give the article a title before publishing.', ok: false, status: 400 })
    expect(fake.created).toEqual([])
    expect(fake.claimed).toEqual([])
    expect(fake.drafts.has('d1')).toBe(true)
  })

  test('an unknown draft is a 404', async () => {
    const fake = fakeDeps(null)
    expect(await publishArticleDraft('alice', 'd1', {}, fake.deps)).toEqual({
      error: 'Draft not found',
      ok: false,
      status: 404,
    })
  })

  test('two concurrent publishes create one post; the other finds the draft gone', async () => {
    const fake = fakeDeps(draftRecord())
    const results = await Promise.all([
      publishArticleDraft('alice', 'd1', {}, fake.deps),
      publishArticleDraft('alice', 'd1', {}, fake.deps),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ error: 'Draft not found', ok: false, status: 404 }])
    expect(fake.created).toHaveLength(1)
  })

  test('a failed post creation puts the draft back as it was', async () => {
    const draft = draftRecord()
    const fake = fakeDeps(draft, { createFails: true })
    await expect(publishArticleDraft('alice', 'd1', {}, fake.deps)).rejects.toThrow('db down')
    expect(fake.drafts.get('d1')).toEqual(draft)
  })

  test('a draft saved invalid between the check and the claim is put back and is a 400', async () => {
    const fake = fakeDeps(draftRecord())
    const claim = fake.deps.claimDraft
    fake.deps.claimDraft = async (user, id) => {
      fake.drafts.set(id, draftRecord({ article: complete({ title: '' }) }))
      return claim(user, id)
    }
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(fake.created).toEqual([])
    expect(fake.drafts.get('d1')?.article.title).toBe('')
  })

  test('a failed restore is logged and the publish error still surfaces', async () => {
    const fake = fakeDeps(draftRecord(), { createFails: true, restoreFails: true })
    await expect(publishArticleDraft('alice', 'd1', {}, fake.deps)).rejects.toThrow('db down')
    expect(fake.logged).toHaveLength(1)
  })
})
