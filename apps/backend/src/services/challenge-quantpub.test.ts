import {
  quantChallengeDocumentSchema,
  quantChallengeEntrySchema,
  quantStandingsSchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeSpecFields,
} from '../db/index.ts'

import {
  bucketsToSamples,
  buildChallengeDocument,
  buildChallengeListItem,
  buildEntryDocument,
  buildStandingsDocument,
  competitionRanks,
  entryToMemberData,
  fromQuantBucket,
  quantMetricForSpec,
  samplesToBuckets,
  toQuantBucket,
} from './challenge-quantpub.ts'

const stepsSpec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: 'auto',
  filter_field: null,
  filter_value: null,
  measure: null,
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
}

const bestSetSpec: ChallengeSpecFields = {
  ...stepsSpec,
  aggregation: 'max',
  filter_field: 'sets.exercise',
  filter_value: 'Push-ups',
  measure: 'max_reps',
  pattern: 'strength_training',
  source_type: 'activity_type',
  unit: 'reps',
}

const START = new Date('2026-10-31T23:00:00Z')
const END = new Date('2026-11-30T23:00:00Z')

const challenge = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: true,
  banner_updated_at: null,
  created_at: START,
  end_ts: END,
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November steps',
  result_published_at: null,
  slug: 'nov',
  spec: stepsSpec,
  start_ts: START,
  timezone: 'Europe/Stockholm',
  updated_at: START,
  ...overrides,
})

const member = (overrides: Partial<ChallengeMemberRecord>): ChallengeMemberRecord => ({
  actor: null,
  cached_buckets: null,
  cached_total: null,
  challenge_id: 'c1',
  data_endpoint_url: null,
  data_last_updated: null,
  display_name: 'm',
  id: 'm',
  identity_base_url: 'https://x/u/m',
  joined_at: START,
  kind: 'remote',
  last_error: null,
  last_fetched_at: null,
  local_user: null,
  status: 'active',
  ...overrides,
})

const ctx = {
  apiBaseUrl: 'https://qs.example/api',
  now: new Date('2026-11-03T20:45:12Z'),
  username: 'freja',
  webHost: 'https://qs.example',
}

describe('quantMetricForSpec', () => {
  test('a built-in metric with a RECOMMENDED key gets the bare key and canonical unit', () => {
    expect(quantMetricForSpec(stepsSpec)).toEqual({ factor: 1, key: 'steps', unit: '1' })
    expect(quantMetricForSpec({ ...stepsSpec, pattern: 'distance', unit: 'km' })).toEqual({
      factor: 1,
      key: 'distance',
      unit: 'm',
    })
    expect(quantMetricForSpec({ ...stepsSpec, pattern: 'sleep_score', unit: 'score' })).toEqual({
      factor: 1,
      key: 'sleepScore',
      unit: '1',
    })
  })

  test('any other metric is an aurboda extension key in the spec unit', () => {
    expect(quantMetricForSpec({ ...stepsSpec, pattern: 'calories_active', unit: 'kcal' })).toEqual({
      factor: 1,
      key: 'aurboda:caloriesActive',
      unit: 'kcal',
    })
  })

  test('an activity type is its duration, or its measure', () => {
    const hours = { ...stepsSpec, pattern: 'running', source_type: 'activity_type' as const, unit: 'hours' }
    expect(quantMetricForSpec(hours)).toEqual({ factor: 1, key: 'aurboda:activityDuration', unit: 'hours' })
    expect(quantMetricForSpec(bestSetSpec)).toEqual({ factor: 1, key: 'aurboda:maxReps', unit: 'reps' })
  })
})

describe('bucket sizes', () => {
  test('map to the FEP grammar, a week and a month as days', () => {
    expect(['5m', '15m', '1h', '1d', '1w', '1M'].map((s) => toQuantBucket(s as '1d'))).toEqual([
      '5m',
      '15m',
      '1h',
      '1d',
      '7d',
      '30d',
    ])
  })

  test('parse back, unknown widths as null', () => {
    expect(fromQuantBucket('7d')).toBe('1w')
    expect(fromQuantBucket('30d')).toBe('1M')
    expect(fromQuantBucket('1h')).toBe('1h')
    expect(fromQuantBucket('2d')).toBeNull()
  })
})

describe('buckets and samples', () => {
  test('a day sample sits at the local midnight, a 25-hour DST day included', () => {
    const start = new Date('2026-10-23T22:00:00Z')
    const buckets = [
      { bucket_start: '2026-10-24T00:00:00+02:00', value: 100 },
      { bucket_start: '2026-10-25T00:00:00+02:00', value: 200 },
      { bucket_start: '2026-10-26T00:00:00+01:00', value: 300 },
    ]
    const samples = bucketsToSamples(buckets, start, 1, 'sum')
    expect(samples).toEqual([
      { count: 1, offset: 0, sum: 100 },
      { count: 1, offset: 86_400, sum: 200 },
      { count: 1, offset: 86_400 + 25 * 3600, sum: 300 },
    ])
    expect(samplesToBuckets(samples, start, 1, 'sum')).toEqual([
      { bucket_start: '2026-10-23T22:00:00.000Z', value: 100 },
      { bucket_start: '2026-10-24T22:00:00.000Z', value: 200 },
      { bucket_start: '2026-10-25T23:00:00.000Z', value: 300 },
    ])
  })

  test('apply the factor both ways, carry max for max scoring, and clamp a bucket before the start', () => {
    const samples = bucketsToSamples([{ bucket_start: '2026-10-26T23:00:00Z', value: 2 }], START, 1000, 'max')
    expect(samples).toEqual([{ count: 1, max: 2000, offset: 0, sum: 2000 }])
    expect(samplesToBuckets([{ max: 2000, offset: 60 }], START, 1000, 'max')).toEqual([
      { bucket_start: '2026-10-31T23:01:00.000Z', value: 2 },
    ])
  })
})

describe('entries', () => {
  const participation: ChallengeParticipationRecord = {
    challenge_url: 'https://qs.example/u/freja/nov',
    created_at: START,
    data_token: 'tok',
    end_ts: END,
    host_identity: 'https://qs.example/u/freja',
    id: 'p1',
    name: 'November steps',
    spec: stepsSpec,
    start_ts: START,
    status: 'active',
    timezone: 'Europe/Stockholm',
  }

  test('a member entry echoes the metric and scoring, with day samples', () => {
    const entry = buildEntryDocument(participation, {
      buckets: [{ bucket_start: '2026-11-01T23:00:00.000Z', value: 8412 }],
      last_updated: '2026-11-02T20:40:00.000Z',
      total: 8412,
    })
    expect(quantChallengeEntrySchema.parse(entry)).toEqual(entry)
    expect(entry).toEqual({
      challenge: 'https://qs.example/u/freja/nov',
      kind: 'challengeEntry',
      lastUpdated: '2026-11-02T20:40:00.000Z',
      metric: 'steps',
      scoring: 'sum',
      series: {
        bucket: '1d',
        metric: 'steps',
        samples: [{ count: 1, offset: 86_400, sum: 8412 }],
        unit: '1',
      },
      total: 8412,
      unit: '1',
    })
  })

  test('a measure entry carries the vendor echo, which converts back to the data response', () => {
    const entry = buildEntryDocument(
      { ...participation, spec: bestSetSpec },
      { buckets: [], last_updated: null, total: 30 },
    )
    expect(entry.aurboda).toEqual({
      aggregation: 'max',
      filterField: 'sets.exercise',
      filterValue: 'Push-ups',
      measure: 'max_reps',
    })
    expect(entryToMemberData(entry, { spec: bestSetSpec, start_ts: START })).toEqual({
      aggregation: 'max',
      buckets: [],
      filter_field: 'sets.exercise',
      filter_value: 'Push-ups',
      last_updated: null,
      measure: 'max_reps',
      success: true,
      total: 30,
    })
  })

  test('a third-party entry converts: samples to buckets, no total left for standings to compute', () => {
    const data = entryToMemberData(
      {
        challenge: 'https://qs.example/u/freja/nov',
        kind: 'challengeEntry',
        metric: 'steps',
        scoring: 'sum',
        series: { bucket: '1d', metric: 'steps', samples: [{ offset: 0, sum: 10 }] },
      },
      { spec: stepsSpec, start_ts: START },
    )
    expect(data).toEqual({
      aggregation: 'sum',
      buckets: [{ bucket_start: START.toISOString(), value: 10 }],
      last_updated: null,
      success: true,
    })
  })

  test('an unknown measure in the vendor block is not echoed', () => {
    const data = entryToMemberData(
      {
        aurboda: { aggregation: 'max', measure: 'max_distance' },
        challenge: 'x',
        kind: 'challengeEntry',
        metric: 'aurboda:maxReps',
        scoring: 'max',
      },
      { spec: bestSetSpec, start_ts: START },
    )
    expect(data).not.toHaveProperty('measure')
  })
})

describe('challenge documents', () => {
  const members = [
    member({
      display_name: 'freja',
      identity_base_url: 'https://qs.example/u/freja',
      kind: 'local',
      local_user: 'freja',
    }),
    member({ actor: null, display_name: 'ola', identity_base_url: 'https://ola.example/', kind: 'remote' }),
    member({ display_name: 'gone', identity_base_url: 'https://gone.example/', status: 'withdrawn' }),
  ]

  test('the document carries the join token, the active members and the vendor spec', () => {
    const doc = buildChallengeDocument(challenge(), members, ctx)
    expect(quantChallengeDocumentSchema.parse(doc)).toEqual(doc)
    expect(doc).toMatchObject({
      aurboda: { spec: { aggregation: 'sum', pattern: 'steps', source_type: 'metric' } },
      bucket: '1d',
      endTime: END.toISOString(),
      host: { actor: 'https://qs.example/users/freja', name: 'freja', url: 'https://qs.example/u/freja' },
      joinMode: 'free',
      joinToken: 'jt',
      kind: 'challenge',
      members: [
        { actor: 'https://qs.example/users/freja', name: 'freja', url: 'https://qs.example/u/freja' },
        { actor: null, name: 'ola', url: 'https://ola.example/' },
      ],
      metric: 'steps',
      scoring: 'sum',
      standingsUrl: 'https://qs.example/api/public/freja/challenges/nov/standings',
      startTime: START.toISOString(),
      timezone: 'Europe/Stockholm',
      unit: '1',
      url: 'https://qs.example/u/freja/nov',
    })
  })

  test('the listing leaves out the join token and the members', () => {
    const item = buildChallengeListItem(challenge(), ctx)
    expect(item).not.toHaveProperty('joinToken')
    expect(item).not.toHaveProperty('members')
  })

  test('an ended challenge is closed to joins', () => {
    expect(buildChallengeListItem(challenge(), { ...ctx, now: END }).joinMode).toBe('none')
  })
})

describe('standings', () => {
  test('competition ranks share equal totals and skip the next rank', () => {
    expect(competitionRanks([10, 10, 5, 1])).toEqual([1, 1, 3, 4])
  })

  test('ranks active members by total and leaves out the withdrawn', () => {
    const standing = (name: string, total: number, status: 'active' | 'withdrawn' = 'active') => ({
      buckets: [{ bucket_start: START.toISOString(), value: total }],
      display_name: name,
      identity_base_url: `https://${name}.example/`,
      last_updated: null,
      stale: false,
      status,
      total,
    })
    const doc = buildStandingsDocument(
      challenge(),
      [standing('a', 5), standing('b', 9), standing('c', 9), standing('gone', 99, 'withdrawn')],
      [member({ actor: 'https://b.example/users/b', identity_base_url: 'https://b.example/' })],
      ctx,
    )
    expect(quantStandingsSchema.parse(doc)).toEqual(doc)
    expect(doc.challenge).toBe('https://qs.example/u/freja/nov')
    expect(doc.asOf).toBe('2026-11-03T20:45:12.000Z')
    expect(doc.bucket).toBe('1d')
    expect(doc.members.map((m) => [m.name, m.rank, m.total, m.actor])).toEqual([
      ['b', 1, 9, 'https://b.example/users/b'],
      ['c', 1, 9, null],
      ['a', 3, 5, null],
    ])
    expect(doc.members[0].samples).toEqual([{ count: 1, offset: 0, sum: 9 }])
  })
})
