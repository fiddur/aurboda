import type { FeedStructuredActivity, WellKnownAurboda } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  type AurbodaEnrichDeps,
  capabilityTokenFrom,
  enrichFromAurboda,
  parseAurbodaFeedUrl,
} from './timeline-enrich.ts'

const UUID = '11111111-2222-4333-8444-555555555555'

describe('parseAurbodaFeedUrl', () => {
  test('parses an Aurboda feed-post object URI', () => {
    expect(parseAurbodaFeedUrl(`https://aurboda.net/users/fredrik/feed/${UUID}`)).toEqual({
      origin: 'https://aurboda.net',
      postId: UUID,
      user: 'fredrik',
    })
  })

  test('decodes a percent-encoded username', () => {
    expect(parseAurbodaFeedUrl(`https://h.example/users/a%20b/feed/${UUID}`)?.user).toBe('a b')
  })

  test('returns null for a Mastodon status URL (no /feed/<uuid> path)', () => {
    expect(parseAurbodaFeedUrl('https://mastodon.social/users/alice/statuses/12345')).toBeNull()
  })

  test('returns null when the postId is not a UUID', () => {
    expect(parseAurbodaFeedUrl('https://aurboda.net/users/fredrik/feed/not-a-uuid')).toBeNull()
  })

  test('returns null for a non-URL', () => {
    expect(parseAurbodaFeedUrl('not a url')).toBeNull()
  })
})

const wellKnown: WellKnownAurboda = {
  api_base: 'https://aurboda.net/api',
  federation: true,
  product: 'aurboda',
  version: '1.0.0',
}

const structured: FeedStructuredActivity = {
  activity_type: 'exercise',
  kind: 'activity',
  metrics: [{ key: 'heart_rate_avg', unit: 'bpm', value: 142 }],
  series: [],
  start_time: '2026-07-01T08:00:00.000Z',
}

describe('enrichFromAurboda', () => {
  test('discovers the peer, fetches the structured endpoint, and returns the payload', async () => {
    const calls: string[] = []
    const deps: AurbodaEnrichDeps = {
      discover: async (base) => {
        calls.push(`discover:${base}`)
        return wellKnown
      },
      fetchStructured: async (url) => {
        calls.push(`fetch:${url}`)
        return { structured, success: true }
      },
    }
    const result = await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps)
    expect(result).toEqual(structured)
    // Discovery uses the object's origin; the structured URL uses the discovered api_base.
    expect(calls).toEqual([
      'discover:https://aurboda.net',
      `fetch:https://aurboda.net/api/public/fredrik/feed/${UUID}`,
    ])
  })

  test('tolerates a kind-less payload from a peer on the previous release (tags it activity)', async () => {
    // The un-tagged `FeedStructured` shape a peer running the previous release emits.
    const legacy = {
      activity_type: 'exercise',
      metrics: [{ key: 'heart_rate_avg', unit: 'bpm', value: 142 }],
      series: [],
      start_time: '2026-07-01T08:00:00.000Z',
    }
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => ({ structured: legacy, success: true }),
    }
    const result = await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps)
    // The preprocess shim tags it `kind:'activity'` so it parses instead of being dropped.
    expect(result).toEqual(structured)
  })

  test('returns null (no fetch) for a non-Aurboda-shaped object URI', async () => {
    let fetched = false
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => {
        fetched = true
        return { structured, success: true }
      },
    }
    expect(await enrichFromAurboda('https://mastodon.social/users/a/statuses/1', deps)).toBeNull()
    expect(fetched).toBe(false)
  })

  test('returns null when the host does not federate (discover throws)', async () => {
    const deps: AurbodaEnrichDeps = {
      discover: async () => {
        throw new Error('not an Aurboda host')
      },
      fetchStructured: async () => ({ structured, success: true }),
    }
    expect(await enrichFromAurboda(`https://mastodon.social/users/a/feed/${UUID}`, deps)).toBeNull()
  })

  test('returns null when the response has no structured payload (404-style body)', async () => {
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => ({ error: 'Not found', success: false }),
    }
    expect(await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps)).toBeNull()
  })

  test('returns null when the response is malformed (schema mismatch)', async () => {
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => ({ structured: { nope: true }, success: true }),
    }
    expect(await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps)).toBeNull()
  })

  test('passes the capability token as ?token= so a followers-only post authorizes', async () => {
    let fetchedUrl = ''
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async (url) => {
        fetchedUrl = url
        return { structured, success: true }
      },
    }
    await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps, 'secret token/&')
    expect(fetchedUrl).toBe(`https://aurboda.net/api/public/fredrik/feed/${UUID}?token=secret%20token%2F%26`)
  })
})

describe('capabilityTokenFrom', () => {
  const image = (url: string) => ({ url })

  test('lifts the token from a followers-only image URL', () => {
    expect(
      capabilityTokenFrom([image('https://aurboda.net/api/public/bob/feed/abc/chart.png?token=t0k')]),
    ).toBe('t0k')
  })

  test('returns undefined for a public image URL (no token) or no images', () => {
    expect(
      capabilityTokenFrom([image('https://aurboda.net/api/public/bob/feed/abc/chart.png')]),
    ).toBeUndefined()
    expect(capabilityTokenFrom([])).toBeUndefined()
  })

  test('skips a malformed URL and finds the token on a later image', () => {
    expect(capabilityTokenFrom([image('not a url'), image('https://h.example/x.png?token=abc')])).toBe('abc')
  })
})
