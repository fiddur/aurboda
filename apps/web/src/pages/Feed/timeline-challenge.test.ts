import type { FeedStructuredChallenge, QuantStandingsMember } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { memberColor } from '../Challenges/member-colors'
import {
  challengeLink,
  formatStandingTotal,
  quantBucketSeconds,
  standingsRaceSeries,
} from './timeline-challenge'

const START = '2026-11-01T00:00:00.000Z'

const member = (name: string, samples: QuantStandingsMember['samples']): QuantStandingsMember => ({
  lastUpdated: null,
  name,
  rank: 1,
  samples,
  stale: false,
  total: 0,
  url: `https://qs.example/u/${name}`,
})

const payload = (over: Partial<FeedStructuredChallenge> = {}, members: QuantStandingsMember[] = []) =>
  ({
    challenge: {
      aurboda: {
        spec: {
          aggregation: 'sum',
          bucket_size: 'auto',
          pattern: 'steps',
          source_type: 'metric',
          unit: 'steps',
        },
      },
      endTime: '2026-12-01T00:00:00.000Z',
      host: { name: 'freja', url: 'https://qs.example/u/freja' },
      kind: 'challenge',
      metric: 'steps',
      name: 'November steps',
      scoring: 'sum',
      startTime: START,
      timezone: 'UTC',
      unit: '1',
      url: 'https://qs.example/u/freja/nov',
    },
    kind: 'challenge',
    standings: {
      asOf: '2026-11-03T12:00:00.000Z',
      bucket: '1d',
      challenge: 'https://qs.example/u/freja/nov',
      kind: 'standings',
      members,
    },
    ...over,
  }) satisfies FeedStructuredChallenge

describe('quantBucketSeconds', () => {
  test('parses every FEP unit', () => {
    expect(quantBucketSeconds('30s')).toBe(30)
    expect(quantBucketSeconds('15m')).toBe(900)
    expect(quantBucketSeconds('1h')).toBe(3600)
    expect(quantBucketSeconds('7d')).toBe(604_800)
  })

  test('is null for anything else', () => {
    expect(quantBucketSeconds('1M')).toBeNull()
    expect(quantBucketSeconds('d')).toBeNull()
    expect(quantBucketSeconds('')).toBeNull()
  })
})

describe('standingsRaceSeries', () => {
  test('a sum challenge runs a cumulative total from the start line, plotted at bucket ends', () => {
    const series = standingsRaceSeries(
      payload({}, [
        member('freja', [
          { offset: 86_400, sum: 300 },
          { offset: 0, sum: 1000 },
        ]),
      ]),
    )
    expect(series).toEqual([
      {
        color: memberColor(0),
        data: [
          { date: START, value: 0 },
          { date: '2026-11-02T00:00:00.000Z', value: 1000 },
          { date: '2026-11-03T00:00:00.000Z', value: 1300 },
        ],
        name: 'freja',
      },
    ])
  })

  test('a max challenge plots the best sample so far', () => {
    const base = payload()
    const structured = payload({ challenge: { ...base.challenge, scoring: 'max' } }, [
      member('olle', [
        { max: 20, offset: 0 },
        { max: 15, offset: 86_400 },
        { offset: 172_800, sum: 25 },
      ]),
    ])
    expect(standingsRaceSeries(structured)[0].data.map((p) => p.value)).toEqual([0, 20, 20, 25])
  })

  test('colours members in leaderboard order and drops a member with no samples', () => {
    const series = standingsRaceSeries(
      payload({}, [
        member('a', [{ offset: 0, sum: 1 }]),
        member('b', []),
        member('c', [{ offset: 0, sum: 1 }]),
      ]),
    )
    expect(series.map((s) => [s.name, s.color])).toEqual([
      ['a', memberColor(0)],
      ['c', memberColor(2)],
    ])
  })

  test('is empty without standings', () => {
    expect(standingsRaceSeries(payload({ standings: undefined }))).toEqual([])
  })
})

describe('formatStandingTotal', () => {
  test('uses the Aurboda spec when it rode along', () => {
    expect(formatStandingTotal(payload(), 12345.6)).toBe((12346).toLocaleString())
  })

  test('falls back to the wire unit without one', () => {
    const base = payload()
    const bare = payload({ challenge: { ...base.challenge, aurboda: undefined, unit: 'm' } })
    expect(formatStandingTotal(bare, 1500.2)).toBe(`${(1500).toLocaleString()} m`)
    const unitless = payload({ challenge: { ...base.challenge, aurboda: undefined, unit: undefined } })
    expect(formatStandingTotal(unitless, 7)).toBe('7')
  })
})

describe('challengeLink', () => {
  test('keeps http(s) URLs', () => {
    expect(challengeLink('https://peer.example/challenges/steps')).toBe(
      'https://peer.example/challenges/steps',
    )
    expect(challengeLink('http://peer.example/challenges/steps')).toBe('http://peer.example/challenges/steps')
  })

  test('drops javascript: and other non-http schemes and junk', () => {
    expect(challengeLink('javascript:alert(document.cookie)')).toBeNull()
    expect(challengeLink('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(challengeLink('not a url')).toBeNull()
  })
})
