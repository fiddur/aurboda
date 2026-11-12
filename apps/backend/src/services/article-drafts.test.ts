import type { ArticleDraftContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ArticleDraftRecord, ArticlePostInput, FeedPostRecord } from '../db/index.ts'

import {
  articleDraftPatch,
  normalizeArticleDraftContent,
  type PublishDraftDeps,
  publishableArticle,
  publishArticleDraft,
  serializeArticleDraft,
} from './article-drafts.ts'

const WEEK_START = '2026-07-01T00:00:00.000Z'
const WEEK_END = '2026-07-07T00:00:00.000Z'
const SAVED_LATER = new Date('2026-07-08T11:05:00Z')

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

/**
 * In-memory deps over one draft store, recording what publishing did. `publishDraft`
 * models the transaction: the draft is back whenever no post was created.
 */
const fakeDeps = (draft: ArticleDraftRecord | null, { createFails = false } = {}) => {
  const drafts = new Map<string, ArticleDraftRecord>(draft ? [[draft.id, draft]] : [])
  const created: ArticlePostInput[] = []
  const claimed: string[] = []
  const deps: PublishDraftDeps = {
    getDraft: async (_user, id) => drafts.get(id) ?? null,
    postTags: async () => ['aurboda'],
    publishDraft: async (_user, id, prepare) => {
      const found = drafts.get(id)
      if (!found) return { status: 'missing' }
      drafts.delete(id)
      claimed.push(id)
      try {
        const prepared = await prepare(found)
        if (!prepared.ok) {
          drafts.set(id, found)
          return { error: prepared.error, status: 'rejected' }
        }
        if (createFails) throw new Error('db down')
        created.push(prepared.input)
        const post = {
          article: prepared.input.article,
          id: `p${created.length}`,
          kind: 'article',
          visibility: prepared.input.visibility,
        } as FeedPostRecord
        return { post, status: 'published' }
      } catch (error) {
        drafts.set(id, found)
        throw error
      }
    },
  }
  return { claimed, created, deps, drafts }
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

  test('stores a challenge URL in its canonical spelling', () => {
    const patch = articleDraftPatch(complete(), {
      blocks: [
        { challenge_url: 'https://qs.example/u/olle/nov?ref=x#frag', type: 'challenge' },
        { type: 'challenge' },
      ],
    })
    expect(patch.article?.blocks).toEqual([
      { challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' },
      { type: 'challenge' },
    ])
  })
})

describe('normalizeArticleDraftContent', () => {
  test('canonicalises challenge URLs and normalises tags', () => {
    const normalized = normalizeArticleDraftContent(
      complete({
        blocks: [{ challenge_url: 'https://QS.example/u/olle/nov/#frag', type: 'challenge' }],
        tags: ['#QS'],
      }),
    )
    expect(normalized.blocks).toEqual([{ challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' }])
    expect(normalized.tags).toEqual(['qs'])
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

  test('rejects a challenge block without a URL', () => {
    const result = publishableArticle(complete({ blocks: [{ type: 'challenge' }] }), 'public')
    expect(!result.ok && result.error).toContain('Challenge block 1 has no challenge')
  })

  test('rejects an impact block without an activity', () => {
    const result = publishableArticle(
      complete({ blocks: [{ activity_type: 'activity_type', type: 'impact' }] }),
      'public',
    )
    expect(result).toEqual({
      error: 'Impact block 1 has no activity — pick one before publishing.',
      ok: false,
    })
  })

  test('rejects a challenge block whose URL is not a challenge link', () => {
    const result = publishableArticle(
      complete({ blocks: [{ challenge_url: 'https://qs.example/about', type: 'challenge' }] }),
      'public',
    )
    expect(!result.ok && result.error).toContain('Block 1: not a challenge URL')
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

  test('a draft failing the lookup checks is a 400 and is never claimed', async () => {
    const fake = fakeDeps(draftRecord())
    fake.deps.checkContent = async () => ({ error: 'Block 2: challenge not found.', ok: false })
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result).toEqual({ error: 'Block 2: challenge not found.', ok: false, status: 400 })
    expect(fake.claimed).toEqual([])
    expect(fake.created).toEqual([])
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

  test('a failed post creation leaves the draft as it was', async () => {
    const draft = draftRecord()
    const fake = fakeDeps(draft, { createFails: true })
    await expect(publishArticleDraft('alice', 'd1', {}, fake.deps)).rejects.toThrow('db down')
    expect(fake.drafts.get('d1')).toEqual(draft)
  })

  test('a draft saved invalid between the check and the claim stays and is a 400', async () => {
    const fake = fakeDeps(draftRecord())
    const get = fake.deps.getDraft
    fake.deps.getDraft = async (user, id) => {
      const found = await get(user, id)
      fake.drafts.set(id, draftRecord({ article: complete({ title: '' }), updated_at: SAVED_LATER }))
      return found
    }
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result).toEqual({ error: 'Give the article a title before publishing.', ok: false, status: 400 })
    expect(fake.created).toEqual([])
    expect(fake.drafts.get('d1')?.article.title).toBe('')
  })

  test('an unchanged claimed draft reuses the checks and tags from before the transaction', async () => {
    const fake = fakeDeps(draftRecord())
    const calls = { checkContent: 0, postTags: 0 }
    fake.deps.checkContent = async (article) => {
      calls.checkContent += 1
      return { article, ok: true }
    }
    fake.deps.postTags = async () => {
      calls.postTags += 1
      return ['aurboda']
    }
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result.ok).toBe(true)
    expect(calls).toEqual({ checkContent: 1, postTags: 1 })
  })

  test('a draft saved between the read and the claim is checked and tagged again', async () => {
    const fake = fakeDeps(draftRecord())
    const resaved = complete({ title: 'A month of HRV' })
    const get = fake.deps.getDraft
    fake.deps.getDraft = async (user, id) => {
      const found = await get(user, id)
      fake.drafts.set(id, draftRecord({ article: resaved, updated_at: SAVED_LATER }))
      return found
    }
    const checked: string[] = []
    fake.deps.checkContent = async (article) => {
      checked.push(article.title)
      return { article, ok: true }
    }
    fake.deps.postTags = async (_user, article) => [article.title === resaved.title ? 'month' : 'week']
    const result = await publishArticleDraft('alice', 'd1', {}, fake.deps)
    expect(result.ok).toBe(true)
    expect(checked).toEqual(['A week of HRV', 'A month of HRV'])
    expect(fake.created).toEqual([{ article: resaved, tags: ['month'], visibility: 'followers' }])
  })
})
