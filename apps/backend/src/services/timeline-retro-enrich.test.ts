import type { FeedStructuredPost } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { UnenrichedTimelineEntry } from '../db/index.ts'

import {
  backfillReplyLinks,
  parseReplyInfo,
  type RetroEnrichDeps,
  retroEnrichTimelineEntries,
} from './timeline-retro-enrich.ts'

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

describe('parseReplyInfo', () => {
  const ME = 'https://aurboda.example/users/me'

  test('reads a string inReplyTo and a Mention tag pointing at me', () => {
    const doc = {
      inReplyTo: 'https://mastodon.example/notes/1',
      tag: [{ href: ME, type: 'Mention' }],
    }
    expect(parseReplyInfo(doc, ME)).toEqual({
      in_reply_to_uri: 'https://mastodon.example/notes/1',
      mentions_me: true,
    })
  })

  test('reads an object-form inReplyTo, a single non-array tag, and foreign mentions', () => {
    const doc = {
      inReplyTo: { id: 'https://mastodon.example/notes/2', type: 'Note' },
      tag: { href: 'https://elsewhere.example/users/other', type: 'Mention' },
    }
    expect(parseReplyInfo(doc, ME)).toEqual({
      in_reply_to_uri: 'https://mastodon.example/notes/2',
      mentions_me: false,
    })
  })

  test('a top-level post without tags yields nulls, as does a non-object doc', () => {
    expect(parseReplyInfo({ content: '<p>hi</p>' }, ME)).toEqual({
      in_reply_to_uri: null,
      mentions_me: false,
    })
    expect(parseReplyInfo(null, ME)).toEqual({ in_reply_to_uri: null, mentions_me: false })
  })
})

describe('backfillReplyLinks', () => {
  test('saves fetched reply info; a failed or non-JSON fetch only stamps (never clobbers)', async () => {
    const saved: [string, string | null, boolean][] = []
    const stamped: string[] = []
    await backfillReplyLinks('u', 'https://aurboda.example/users/u', {
      fetchObject: async (uri) => {
        if (uri === 'https://m.example/notes/reply') {
          return { inReplyTo: 'https://m.example/notes/root', tag: [] }
        }
        if (uri === 'https://m.example/notes/html') return '<!doctype html>…'
        return null
      },
      listUnchecked: async () => [
        { id: 'a', object_uri: 'https://m.example/notes/reply' },
        { id: 'b', object_uri: 'https://m.example/notes/gone' },
        { id: 'c', object_uri: 'https://m.example/notes/html' },
      ],
      markChecked: async (_u, id) => {
        stamped.push(id)
      },
      saveReplyInfo: async (_u, id, inReplyToUri, mentionsMe) => {
        saved.push([id, inReplyToUri, mentionsMe])
      },
    })
    // Only the real AS2 answer writes reply state; the 404 and the HTML body
    // are non-answers — a row that already carried a correct in_reply_to_uri
    // (ingested between #1061 and the backstamp migration) must keep it.
    expect(saved).toEqual([['a', 'https://m.example/notes/root', false]])
    expect(stamped).toEqual(['b', 'c'])
  })
})
