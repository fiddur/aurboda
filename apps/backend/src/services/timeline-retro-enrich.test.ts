import type { FeedStructuredPost } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { UnenrichedTimelineEntry } from '../db/index.ts'

import { type RetroEnrichDeps, retroEnrichTimelineEntries } from './timeline-retro-enrich.ts'

const UUID = '11111111-2222-4333-8444-555555555555'

const structured: FeedStructuredPost = {
  activity_type: 'exercise',
  kind: 'activity',
  metrics: [],
  series: [],
  start_time: '2026-07-01T08:00:00.000Z',
}

const aurbodaEntry = (
  id: string,
  images: UnenrichedTimelineEntry['images'] = null,
): UnenrichedTimelineEntry => ({
  id,
  images,
  object_uri: `https://peer.example/users/bob/feed/${UUID}`,
})

const deps = (
  entries: UnenrichedTimelineEntry[],
  enrichResult: FeedStructuredPost | null,
): RetroEnrichDeps & {
  enriched: string[]
  saved: [string, FeedStructuredPost | null][]
  transient: string[]
} => {
  const enriched: string[] = []
  const saved: [string, FeedStructuredPost | null][] = []
  const transient: string[] = []
  return {
    enrich: async (uri, token) => {
      enriched.push(`${uri}?token=${token ?? ''}`)
      return enrichResult
    },
    enriched,
    listUnenriched: async (_user, limit) => entries.slice(0, limit),
    recordTransientFailure: async (_user, id) => {
      transient.push(id)
    },
    save: async (_user, id, payload) => {
      saved.push([id, payload])
    },
    saved,
    transient,
  }
}

describe('retroEnrichTimelineEntries', () => {
  test('enriches eligible entries and stores the payload', async () => {
    const d = deps([aurbodaEntry('a'), aurbodaEntry('b')], structured)
    expect(await retroEnrichTimelineEntries('u', d)).toBe(2)
    expect(d.saved).toEqual([
      ['a', structured],
      ['b', structured],
    ])
  })

  test('stamps a failed attempt (null) so the entry is not retried forever', async () => {
    const d = deps([aurbodaEntry('a')], null)
    expect(await retroEnrichTimelineEntries('u', d)).toBe(0)
    expect(d.saved).toEqual([['a', null]])
  })

  test('lifts the capability token from the stored images (followers-only posts)', async () => {
    const images = [{ url: 'https://peer.example/api/public/bob/feed/x/chart.png?token=sekrit' }]
    const d = deps([aurbodaEntry('a', images)], structured)
    await retroEnrichTimelineEntries('u', d)
    expect(d.enriched).toEqual([`https://peer.example/users/bob/feed/${UUID}?token=sekrit`])
  })

  test('stamps (without fetching) an entry the SQL prefilter matched but that is not an Aurboda object', async () => {
    const notAurboda: UnenrichedTimelineEntry = {
      id: 'weird',
      images: null,
      object_uri: 'https://mastodon.example/users/a/feed/not-a-uuid',
    }
    const d = deps([notAurboda], structured)
    expect(await retroEnrichTimelineEntries('u', d)).toBe(0)
    expect(d.enriched).toEqual([])
    expect(d.saved).toEqual([['weird', null]])
  })

  test('respects the batch size', async () => {
    const d = deps([aurbodaEntry('a'), aurbodaEntry('b'), aurbodaEntry('c')], structured)
    expect(await retroEnrichTimelineEntries('u', d, 2)).toBe(2)
    expect(d.saved.map(([id]) => id)).toEqual(['a', 'b'])
  })

  test('a TRANSIENT failure records a bounded attempt (not a stamp) and continues (#1014)', async () => {
    const saved: string[] = []
    const transient: string[] = []
    const d: RetroEnrichDeps = {
      enrich: async (uri) => {
        if (uri.includes('flaky')) throw new Error('ETIMEDOUT')
        return structured
      },
      listUnenriched: async () => [
        { id: 'flaky', images: null, object_uri: `https://flaky.example/users/a/feed/${UUID}` },
        { id: 'fine', images: null, object_uri: `https://peer.example/users/b/feed/${UUID}` },
      ],
      recordTransientFailure: async (_user, id, maxAttempts) => {
        transient.push(`${id}:${maxAttempts}`)
      },
      save: async (_user, id) => {
        saved.push(id)
      },
    }
    expect(await retroEnrichTimelineEntries('u', d)).toBe(1)
    // 'flaky' was NOT saved/stamped — its bounded attempt counter was bumped
    // instead (retryable until the cap); 'fine' was stored.
    expect(saved).toEqual(['fine'])
    expect(transient).toEqual(['flaky:3'])
  })
})
