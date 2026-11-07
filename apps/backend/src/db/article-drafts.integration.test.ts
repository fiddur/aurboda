import type { ArticleContent, ArticleDraftContent, FeedVisibility } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestDbClient, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  createArticleDraft,
  deleteArticleDraft,
  type DraftPostPreparation,
  getArticleDraft,
  listArticleDrafts,
  publishArticleDraftPost,
  updateArticleDraft,
} from './article-drafts.ts'
import { listFeedPosts } from './feed.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING_ID = '00000000-0000-0000-0000-000000000000'

const content = (overrides: Partial<ArticleDraftContent> = {}): ArticleDraftContent => ({
  blocks: [
    { markdown: 'Half a thought…', type: 'prose' },
    { type: 'chart' },
    { trigger: { kind: 'activity', pattern: 'run' }, type: 'correlation' },
  ],
  title: '',
  ...overrides,
})

const setUpdatedAt = (id: string, ts: string): Promise<unknown> =>
  getTestDbClient().query('UPDATE article_drafts SET updated_at = $1::timestamptz WHERE id = $2', [ts, id])

describe('Article drafts integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('creates an incomplete draft and round-trips it by id', async () => {
    const user = getTestUser()
    const created = await createArticleDraft(user, { article: content(), visibility: 'followers' })

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.article).toEqual(content())
    expect(created.visibility).toBe('followers')
    expect(created.created_at).toBeInstanceOf(Date)
    expect(created.updated_at).toBeInstanceOf(Date)

    expect(await getArticleDraft(user, created.id)).toEqual(created)
    expect(await getArticleDraft(user, MISSING_ID)).toBeNull()
  })

  test('lists drafts most recently saved first', async () => {
    const user = getTestUser()
    const older = await createArticleDraft(user, {
      article: content({ title: 'Older' }),
      visibility: 'public',
    })
    const newer = await createArticleDraft(user, {
      article: content({ title: 'Newer' }),
      visibility: 'public',
    })
    await setUpdatedAt(older.id, '2026-07-01T00:00:00Z')
    await setUpdatedAt(newer.id, '2026-07-02T00:00:00Z')

    expect((await listArticleDrafts(user)).map((d) => d.id)).toEqual([newer.id, older.id])

    await updateArticleDraft(user, older.id, { article: content({ title: 'Older, revised' }) })
    expect((await listArticleDrafts(user)).map((d) => d.id)).toEqual([older.id, newer.id])
  })

  test('updates only the provided columns and bumps updated_at', async () => {
    const user = getTestUser()
    const created = await createArticleDraft(user, {
      article: content({ title: 'v1' }),
      visibility: 'public',
    })
    await setUpdatedAt(created.id, '2026-07-01T00:00:00Z')

    const visOnly = await updateArticleDraft(user, created.id, { visibility: 'unlisted' })
    expect(visOnly?.visibility).toBe('unlisted')
    expect(visOnly?.article.title).toBe('v1')
    expect(visOnly!.updated_at.getTime()).toBeGreaterThan(new Date('2026-07-01T00:00:00Z').getTime())

    const articleOnly = await updateArticleDraft(user, created.id, { article: content({ title: 'v2' }) })
    expect(articleOnly?.article.title).toBe('v2')
    expect(articleOnly?.visibility).toBe('unlisted')
    expect(articleOnly?.created_at).toEqual(created.created_at)

    expect(await updateArticleDraft(user, MISSING_ID, { visibility: 'public' })).toBeNull()
  })

  test('deletes a draft, reporting whether one existed', async () => {
    const user = getTestUser()
    const created = await createArticleDraft(user, { article: content(), visibility: 'public' })

    expect(await deleteArticleDraft(user, created.id)).toBe(true)
    expect(await getArticleDraft(user, created.id)).toBeNull()
    expect(await deleteArticleDraft(user, created.id)).toBe(false)
  })

  describe('publishArticleDraftPost', () => {
    const article: ArticleContent = { blocks: [{ markdown: 'Done.', type: 'prose' }], title: 'Finished' }
    const prepared =
      (visibility: FeedVisibility = 'public') =>
      async (): Promise<DraftPostPreparation> => ({
        input: { article, tags: ['aurboda'], visibility },
        ok: true,
      })

    test('removes the draft and creates the post together', async () => {
      const user = getTestUser()
      const created = await createArticleDraft(user, { article: content(), visibility: 'unlisted' })
      const seen: unknown[] = []

      const outcome = await publishArticleDraftPost(user, created.id, async (draft) => {
        seen.push(draft)
        return prepared('unlisted')()
      })

      expect(seen).toEqual([created])
      expect(outcome.status).toBe('published')
      const posts = await listFeedPosts(user, 50)
      expect(posts.map((p) => [p.id, p.kind, p.article, p.tags, p.visibility])).toEqual([
        [outcome.status === 'published' && outcome.post.id, 'article', article, ['aurboda'], 'unlisted'],
      ])
      expect(await getArticleDraft(user, created.id)).toBeNull()
    })

    test('a failed post insert keeps the draft and creates no post', async () => {
      const user = getTestUser()
      const created = await createArticleDraft(user, { article: content(), visibility: 'public' })

      // `visibility` is VARCHAR(12): a longer value makes the INSERT fail after the DELETE.
      await expect(
        publishArticleDraftPost(user, created.id, prepared('x'.repeat(13) as FeedVisibility)),
      ).rejects.toThrow()

      expect(await getArticleDraft(user, created.id)).toEqual(created)
      expect(await listFeedPosts(user, 50)).toEqual([])
    })

    test('a rejection keeps the draft and reports the error', async () => {
      const user = getTestUser()
      const created = await createArticleDraft(user, { article: content(), visibility: 'public' })

      const outcome = await publishArticleDraftPost(user, created.id, async () => ({
        error: 'Give the article a title before publishing.',
        ok: false,
      }))

      expect(outcome).toEqual({ error: 'Give the article a title before publishing.', status: 'rejected' })
      expect(await getArticleDraft(user, created.id)).toEqual(created)
      expect(await listFeedPosts(user, 50)).toEqual([])
    })

    test('of two concurrent publishes one creates the post, the other finds the draft gone', async () => {
      const user = getTestUser()
      const created = await createArticleDraft(user, { article: content(), visibility: 'public' })

      const outcomes = await Promise.all([
        publishArticleDraftPost(user, created.id, prepared()),
        publishArticleDraftPost(user, created.id, prepared()),
      ])

      expect(outcomes.map((o) => o.status).sort()).toEqual(['missing', 'published'])
      expect(await listFeedPosts(user, 50)).toHaveLength(1)
      expect(await getArticleDraft(user, created.id)).toBeNull()
    })

    test('an unknown draft is missing', async () => {
      expect(await publishArticleDraftPost(getTestUser(), MISSING_ID, prepared())).toEqual({
        status: 'missing',
      })
    })
  })

  test('a draft is not a feed post', async () => {
    const user = getTestUser()
    await createArticleDraft(user, { article: content({ title: 'Secret' }), visibility: 'public' })
    expect(await listFeedPosts(user, 50)).toEqual([])
  })
})
