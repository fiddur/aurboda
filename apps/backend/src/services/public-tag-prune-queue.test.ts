import { describe, expect, test } from 'vitest'

import { prunePublicTagPages, type PublicTagPruneDeps } from './public-tag-prune-queue.ts'

const keep = { handles: ['@fiddur@aurboda.net'], tags: ['aurbodablog'] }

const pruneDeps = (calls: unknown[], overrides: Partial<PublicTagPruneDeps> = {}): PublicTagPruneDeps => ({
  followedTags: async () => ['aurboda', 'aurbodablog'],
  now: () => new Date('2026-11-10T00:00:00Z'),
  officialFeedKeep: async () => keep,
  prune: async (olderThan, kept) => {
    calls.push(['prune', olderThan.toISOString(), kept])
    return 3
  },
  pruneNotTagged: async (tags) => {
    calls.push(['pruneNotTagged', tags])
    return 2
  },
  refollow: async (tags) => {
    calls.push(['refollow', tags])
  },
  retentionDays: async () => 30,
  ...overrides,
})

describe('prunePublicTagPages', () => {
  test('re-applies the follows, then drops old posts but the official feed’s, and posts with no followed tag', async () => {
    const calls: unknown[] = []
    expect(await prunePublicTagPages(pruneDeps(calls))).toBe(5)
    expect(calls).toEqual([
      ['refollow', ['aurboda', 'aurbodablog']],
      ['prune', '2026-10-11T00:00:00.000Z', keep],
      ['pruneNotTagged', ['aurboda', 'aurbodablog']],
    ])
  })

  test('still prunes when re-applying the follows fails, and reports it', async () => {
    const calls: unknown[] = []
    const errors: unknown[] = []
    const deps = pruneDeps(calls, {
      onRefollowError: (error) => errors.push(error),
      refollow: async () => {
        throw new Error('tags.pub unreachable')
      },
    })
    expect(await prunePublicTagPages(deps)).toBe(5)
    expect(calls.map((call) => (call as unknown[])[0])).toEqual(['prune', 'pruneNotTagged'])
    expect(errors).toEqual([new Error('tags.pub unreachable')])
  })
})
