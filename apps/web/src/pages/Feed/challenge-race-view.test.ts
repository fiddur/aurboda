import type { ChallengeStanding, PublicChallenge, QuantChallengeDocument } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  asStructuredChallenge,
  challengeHost,
  liveRaceView,
  localChallengeRef,
  structuredRaceView,
} from './challenge-race-view'

const doc: QuantChallengeDocument = {
  endTime: '2026-12-01T00:00:00.000Z',
  host: { name: 'eva', url: 'https://other.example/u/eva' },
  kind: 'challenge',
  metric: 'steps',
  name: 'Eva’s steps',
  scoring: 'sum',
  startTime: '2026-11-01T00:00:00.000Z',
  timezone: 'UTC',
  unit: 'steps',
  url: 'https://other.example/u/eva/nov',
}

const publicChallenge: PublicChallenge = {
  effective_bucket_size: '1d',
  end_ts: '2026-12-01T00:00:00.000Z',
  host_identity: 'https://qs.example/u/freja',
  join_token: 'jt',
  members: [],
  name: 'November steps',
  profile_url: 'https://qs.example/u/freja',
  share_url: 'https://qs.example/u/freja/nov',
  spec: { aggregation: 'sum', bucket_size: 'auto', pattern: 'steps', source_type: 'metric', unit: 'steps' },
  start_ts: '2026-11-01T00:00:00.000Z',
  timezone: 'UTC',
  visibility: 'public',
}

const standing = (name: string, total: number, over: Partial<ChallengeStanding> = {}): ChallengeStanding => ({
  buckets: [{ bucket_start: '2026-11-01T00:00:00.000Z', value: total }],
  display_name: name,
  identity_base_url: `https://qs.example/u/${name}`,
  last_updated: null,
  stale: false,
  status: 'active',
  total,
  ...over,
})

describe('localChallengeRef', () => {
  const origin = 'https://qs.example'

  test('a challenge link on this instance gives its user and slug', () => {
    expect(localChallengeRef('https://qs.example/u/freja/nov', origin)).toEqual({
      slug: 'nov',
      username: 'freja',
    })
    expect(localChallengeRef('https://qs.example/u/fr%20eja/nov/?embed=1', origin)).toEqual({
      slug: 'nov',
      username: 'fr eja',
    })
  })

  test('another origin, another path or a broken URL is not local', () => {
    expect(localChallengeRef('https://other.example/u/freja/nov', origin)).toBeNull()
    expect(localChallengeRef('https://qs.example/challenges', origin)).toBeNull()
    expect(localChallengeRef('https://qs.example/u/freja/nov/extra', origin)).toBeNull()
    expect(localChallengeRef('not a url', origin)).toBeNull()
  })
})

describe('challengeHost', () => {
  test('the host of a link, or null', () => {
    expect(challengeHost('https://other.example/u/eva/nov')).toBe('other.example')
    expect(challengeHost('nope')).toBeNull()
  })
})

describe('structuredRaceView', () => {
  test('a resolved document without standings has no rows, no race and no as-of line', () => {
    const view = structuredRaceView(asStructuredChallenge(doc, undefined))
    expect(view).toMatchObject({
      link: 'https://other.example/u/eva/nov',
      name: 'Eva’s steps',
      rows: [],
      series: [],
      specLabel: 'steps · sum',
      totalHeader: 'Total',
    })
    expect(view.asOf).toBeUndefined()
    expect(view.xDomain[1].toISOString()).toBe('2026-11-30T23:59:59.999Z')
  })

  test('a peer-supplied non-http link is dropped', () => {
    expect(
      structuredRaceView(asStructuredChallenge({ ...doc, url: 'javascript:alert(1)' }, undefined)).link,
    ).toBeNull()
  })

  test('standings become ranked rows and an as-of line', () => {
    const view = structuredRaceView(
      asStructuredChallenge(doc, {
        asOf: '2026-11-03T12:00:00.000Z',
        bucket: '1d',
        challenge: doc.url,
        kind: 'standings',
        members: [
          {
            lastUpdated: null,
            name: 'eva',
            rank: 1,
            samples: [{ offset: 0, sum: 500 }],
            stale: true,
            total: 500,
            url: 'https://other.example/u/eva',
          },
        ],
      }),
    )
    expect(view.rows).toEqual([
      { key: 'https://other.example/u/eva', name: 'eva', rank: 1, stale: true, total: '500 steps' },
    ])
    expect(view.series).toHaveLength(1)
    expect(view.asOf).toBe('2026-11-03T12:00:00.000Z')
  })
})

describe('liveRaceView', () => {
  test('active members ranked by total, equal totals sharing a rank, one race line each', () => {
    const view = liveRaceView(publicChallenge, [
      standing('freja', 1200),
      standing('olle', 1200),
      standing('eva', 300),
      standing('gone', 9000, { status: 'withdrawn' }),
    ])
    expect(view.rows.map((r) => [r.name, r.rank])).toEqual([
      ['freja', 1],
      ['olle', 1],
      ['eva', 3],
    ])
    expect(view.series).toHaveLength(3)
    expect(view.link).toBe('https://qs.example/u/freja/nov')
    expect(view.asOf).toBeUndefined()
  })

  test('no standings yet draws nothing', () => {
    const view = liveRaceView(publicChallenge, [])
    expect(view.rows).toEqual([])
    expect(view.series).toEqual([])
  })
})
