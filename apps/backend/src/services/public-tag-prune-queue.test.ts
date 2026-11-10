import { describe, expect, test } from 'vitest'

import { prunePublicTagPages, type PublicTagPruneDeps } from './public-tag-prune-queue.ts'

describe('prunePublicTagPages', () => {
  test('drops posts past the retention and posts with no configured tag left', async () => {
    const calls: unknown[] = []
    const deps: PublicTagPruneDeps = {
      now: () => new Date('2026-11-10T00:00:00Z'),
      prune: async (olderThan) => {
        calls.push(['prune', olderThan.toISOString()])
        return 3
      },
      pruneNotTagged: async (tags) => {
        calls.push(['pruneNotTagged', tags])
        return 2
      },
      publicTagPages: async () => ['aurboda'],
      retentionDays: async () => 30,
    }
    expect(await prunePublicTagPages(deps)).toBe(5)
    expect(calls).toEqual([
      ['prune', '2026-10-11T00:00:00.000Z'],
      ['pruneNotTagged', ['aurboda']],
    ])
  })
})
