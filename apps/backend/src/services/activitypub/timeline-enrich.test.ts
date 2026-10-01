import type { FeedStructuredActivity, WellKnownQuantpub } from '@aurboda/api-spec'
import type { AxiosResponse } from 'axios'

import { AxiosError } from 'axios'
import { describe, expect, test } from 'vitest'

import {
  type AurbodaEnrichDeps,
  capabilityTokenFrom,
  enrichFromAurboda,
  isDefinitiveEnrichError,
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

const wellKnown: WellKnownQuantpub = {
  apiBase: 'https://aurboda.net/api',
  product: 'aurboda',
  quantpub: '0.2',
  version: '1.0.0',
}

const structured: FeedStructuredActivity = {
  activityType: 'exercise',
  kind: 'activity',
  metrics: [{ key: 'heartRateAvg', unit: 'bpm', value: 142 }],
  series: [],
  startTime: '2026-07-01T08:00:00.000Z',
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
    // Discovery uses the object's origin; the structured URL uses the discovered apiBase.
    expect(calls).toEqual([
      'discover:https://aurboda.net',
      `fetch:https://aurboda.net/api/public/fredrik/feed/${UUID}`,
    ])
  })

  test('tolerates a kind-less payload from a peer on the previous release (tags it activity)', async () => {
    const { kind: _kind, ...legacy } = structured
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => ({ structured: legacy, success: true }),
    }
    const result = await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps)
    // The preprocess shim tags it `kind:'activity'` so it parses instead of being dropped.
    expect(result).toEqual(structured)
  })

  test('enriches from a QuantPub 0.1 origin (api_base discovery, snake_case payload) to 0.2', async () => {
    const urls: string[] = []
    const deps: AurbodaEnrichDeps = {
      discover: async () => ({
        api_base: 'https://vertmatch.run/api',
        product: 'vertmatch',
        quantpub: '0.1',
        version: '3',
      }),
      fetchStructured: async (url) => {
        urls.push(url)
        return {
          structured: {
            activity_type: 'exercise',
            duration_seconds: 2400,
            end_time: '2026-07-01T08:40:00.000Z',
            kind: 'activity',
            metrics: [
              { key: 'heart_rate_avg', unit: 'bpm', value: 142 },
              { key: 'hr_zone_minutes', value: { z2: 22 } },
            ],
            series: [{ bucket: '5s', metric: 'heart_rate', samples: [], unit: 'bpm' }],
            start_time: '2026-07-01T08:00:00.000Z',
            title: 'Morning run',
          },
          success: true,
        }
      },
    }
    const result = await enrichFromAurboda(`https://vertmatch.run/users/fredrik/feed/${UUID}`, deps)
    expect(urls).toEqual([`https://vertmatch.run/api/public/fredrik/feed/${UUID}`])
    expect(result).toEqual({
      activityType: 'exercise',
      endTime: '2026-07-01T08:40:00.000Z',
      kind: 'activity',
      metrics: [
        { key: 'heartRateAvg', unit: 'bpm', value: 142 },
        { key: 'hrZoneMinutes', value: { z2: 22 } },
      ],
      name: 'Morning run',
      series: [{ bucket: '5s', metric: 'heartRate', samples: [], unit: 'bpm' }],
      startTime: '2026-07-01T08:00:00.000Z',
    })
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

  test('propagates a discovery failure so the caller can log it (#996)', async () => {
    const deps: AurbodaEnrichDeps = {
      discover: async () => {
        throw new Error('not an Aurboda host')
      },
      fetchStructured: async () => ({ structured, success: true }),
    }
    await expect(enrichFromAurboda(`https://mastodon.social/users/a/feed/${UUID}`, deps)).rejects.toThrow(
      'not an Aurboda host',
    )
  })

  test('returns null when the response has no structured payload (404-style body)', async () => {
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => ({ error: 'Not found', success: false }),
    }
    expect(await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps)).toBeNull()
  })

  test('throws on a malformed response (schema mismatch) so the caller can log it (#996)', async () => {
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => ({ structured: { nope: true }, success: true }),
    }
    await expect(enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps)).rejects.toThrow(
      'malformed structured response',
    )
  })

  test('resolves a SAME-instance post in-process — no discovery, no HTTP (#996)', async () => {
    const calls: string[] = []
    const deps: AurbodaEnrichDeps = {
      discover: async () => {
        calls.push('discover')
        return wellKnown
      },
      fetchStructured: async () => {
        calls.push('fetch')
        return { structured, success: true }
      },
      local: {
        // Trailing slash exercises the origin normalisation.
        origin: 'https://aurboda.net/',
        resolve: async (user, postId, token) => {
          calls.push(`local:${user}/${postId}?token=${token ?? ''}`)
          return structured
        },
      },
    }
    const result = await enrichFromAurboda(`https://aurboda.net/users/fredrik/feed/${UUID}`, deps, 'tok')
    expect(result).toEqual(structured)
    expect(calls).toEqual([`local:fredrik/${UUID}?token=tok`])
  })

  test('a DIFFERENT origin still goes over HTTP despite the local shortcut', async () => {
    let local = false
    const deps: AurbodaEnrichDeps = {
      discover: async () => wellKnown,
      fetchStructured: async () => ({ structured, success: true }),
      local: {
        origin: 'https://aurboda.net',
        resolve: async () => {
          local = true
          return null
        },
      },
    }
    const result = await enrichFromAurboda(`https://other.example/users/bob/feed/${UUID}`, deps)
    expect(result).toEqual(structured)
    expect(local).toBe(false)
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

describe('isDefinitiveEnrichError', () => {
  test('a definite HTTP answer (4xx) is definitive — a gone/unauthorized post surfaces as an axios 404', () => {
    const notFound = new AxiosError('Request failed', '404', undefined, undefined, {
      status: 404,
    } as AxiosResponse)
    expect(isDefinitiveEnrichError(notFound)).toBe(true)
  })

  test('a malformed structured response is definitive', () => {
    expect(isDefinitiveEnrichError(new Error('malformed structured response'))).toBe(true)
  })

  test('connection errors, timeouts, and 5xx stay transient', () => {
    expect(isDefinitiveEnrichError(new Error('ETIMEDOUT'))).toBe(false)
    expect(isDefinitiveEnrichError(new AxiosError('connect ECONNREFUSED'))).toBe(false)
    const serverError = new AxiosError('Request failed', '500', undefined, undefined, {
      status: 502,
    } as AxiosResponse)
    expect(isDefinitiveEnrichError(serverError)).toBe(false)
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
