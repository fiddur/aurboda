import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import { type ArticleMentionDeps, keepTypedMentions, resolveArticleMentions } from './article-mentions.ts'

const article = (...markdowns: string[]): Pick<ArticleContent, 'blocks'> => ({
  blocks: markdowns.map((markdown) => ({ markdown, type: 'prose' as const })),
})

const deps = (overrides: Partial<ArticleMentionDeps> = {}): ArticleMentionDeps => ({
  resolveRemote: vi.fn(async (_user: string, handle: string) =>
    handle === '@anna@example.social' ? 'https://example.social/users/anna' : null,
  ),
  userExists: vi.fn(async (username: string) => username === 'delvoriah'),
  webHost: 'https://aurboda.net',
  ...overrides,
})

describe('resolveArticleMentions', () => {
  test('a local handle resolves to the actor without a remote lookup', async () => {
    const d = deps()
    expect(await resolveArticleMentions(d, 'alice', article('Hi @Delvoriah@aurboda.net'))).toEqual([
      { actor_uri: 'https://aurboda.net/users/delvoriah', handle: '@Delvoriah@aurboda.net' },
    ])
    expect(d.userExists).toHaveBeenCalledWith('delvoriah')
    expect(d.resolveRemote).not.toHaveBeenCalled()
  })

  test('a local handle naming no user is left out', async () => {
    expect(await resolveArticleMentions(deps(), 'alice', article('@nobody@aurboda.net'))).toEqual([])
  })

  test('a remote handle is looked up; an unresolved one is skipped', async () => {
    const d = deps()
    expect(
      await resolveArticleMentions(d, 'alice', article('@anna@example.social and @ghost@example.org')),
    ).toEqual([{ actor_uri: 'https://example.social/users/anna', handle: '@anna@example.social' }])
    expect(d.resolveRemote).toHaveBeenCalledTimes(2)
  })

  test('a failing or missing remote resolver resolves nothing', async () => {
    const failing = deps({ resolveRemote: vi.fn(async () => Promise.reject(new Error('down'))) })
    expect(await resolveArticleMentions(failing, 'alice', article('@anna@example.social'))).toEqual([])
    expect(
      await resolveArticleMentions(
        deps({ resolveRemote: undefined }),
        'alice',
        article('@anna@example.social'),
      ),
    ).toEqual([])
  })

  test('a handle the post already mentions keeps its account without a lookup', async () => {
    const d = deps()
    const stored = [{ actor_uri: 'https://example.social/users/anna', handle: '@anna@example.social' }]
    expect(await resolveArticleMentions(d, 'alice', article('@ANNA@example.social'), stored)).toEqual([
      { actor_uri: 'https://example.social/users/anna', handle: '@ANNA@example.social' },
    ])
    expect(d.resolveRemote).not.toHaveBeenCalled()
  })

  test('a stored mention whose handle left the prose is dropped', async () => {
    const stored = [{ actor_uri: 'https://example.social/users/anna', handle: '@anna@example.social' }]
    expect(await resolveArticleMentions(deps(), 'alice', article('No one now.'), stored)).toEqual([])
  })

  test('collects across prose blocks, one per account, ignoring other blocks', async () => {
    const d = deps({ resolveRemote: vi.fn(async () => 'https://example.social/users/anna') })
    const content: Pick<ArticleContent, 'blocks'> = {
      blocks: [
        { markdown: '@anna@example.social', type: 'prose' },
        { metric: 'heart_rate', type: 'chart' },
        { markdown: '@anna@alias.example.social', type: 'prose' },
      ],
    }
    expect(await resolveArticleMentions(d, 'alice', content)).toEqual([
      { actor_uri: 'https://example.social/users/anna', handle: '@anna@example.social' },
    ])
  })

  test('resolves at most ten handles', async () => {
    const d = deps({
      resolveRemote: vi.fn(async (_user: string, handle: string) => `https://x.se/${handle}`),
    })
    const text = Array.from({ length: 12 }, (_, i) => `@u${i}@example.org`).join(' ')
    expect(await resolveArticleMentions(d, 'alice', article(text))).toHaveLength(10)
    expect(d.resolveRemote).toHaveBeenCalledTimes(10)
  })
})

describe('keepTypedMentions', () => {
  test('keeps only the mentions whose handle the prose still types', () => {
    const anna = { actor_uri: 'https://example.social/users/anna', handle: '@anna@example.social' }
    const bo = { actor_uri: 'https://example.org/users/bo', handle: '@bo@example.org' }
    expect(keepTypedMentions(article('Hi @Anna@example.social'), [anna, bo])).toEqual([anna])
  })
})
