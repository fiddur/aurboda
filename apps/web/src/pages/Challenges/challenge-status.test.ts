import type { Challenge, ChallengeParticipation } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  calendarDaysUntil,
  challengeItemKey,
  challengeRangeLabel,
  challengeTimePhrase,
  challengeTimeStatus,
  groupChallengeItems,
} from './challenge-status'

// Fixed instants; construction without timezone suffix uses the runner's local
// timezone consistently on both sides, so the tests are tz-independent.
const iso = (local: string) => new Date(local).toISOString()

// A one-week challenge: 1 Jun 00:00 (inclusive) .. 8 Jun 00:00 (exclusive),
// built in the runner's local timezone so viewer-local assertions hold anywhere.
const start = iso('2026-06-01T00:00:00')
const end = iso('2026-06-08T00:00:00')
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

describe('challengeTimeStatus', () => {
  test('before the start instant is upcoming', () => {
    expect(challengeTimeStatus(start, end, new Date('2026-05-31T23:59:59'))).toBe('upcoming')
  })

  test('the start instant itself is ongoing (inclusive)', () => {
    expect(challengeTimeStatus(start, end, new Date(start))).toBe('ongoing')
  })

  test('just before the end instant is ongoing', () => {
    expect(challengeTimeStatus(start, end, new Date('2026-06-07T23:59:59'))).toBe('ongoing')
  })

  test('the end instant itself is ended (exclusive)', () => {
    expect(challengeTimeStatus(start, end, new Date(end))).toBe('ended')
  })
})

describe('calendarDaysUntil', () => {
  test('same local day is 0 regardless of clock time', () => {
    expect(calendarDaysUntil(new Date('2026-06-03T23:00:00'), new Date('2026-06-03T01:00:00'))).toBe(0)
  })

  test('counts local calendar days, not 24h periods', () => {
    expect(calendarDaysUntil(new Date('2026-06-04T01:00:00'), new Date('2026-06-03T23:00:00'))).toBe(1)
  })

  test('is negative for past days', () => {
    expect(calendarDaysUntil(new Date('2026-06-01T12:00:00'), new Date('2026-06-03T12:00:00'))).toBe(-2)
  })
})

describe('challengeTimePhrase', () => {
  test('upcoming: today / tomorrow / in N days', () => {
    // At the start instant the challenge is already ongoing, so at a one-week
    // horizon the phrase is the full remaining window.
    expect(challengeTimePhrase(start, end, tz, new Date('2026-06-01T00:00:00'))).toBe('Ends in 6 days')
    expect(challengeTimePhrase(start, end, tz, new Date('2026-05-31T12:00:00'))).toBe('Starts tomorrow')
    expect(challengeTimePhrase(start, end, tz, new Date('2026-05-29T12:00:00'))).toBe('Starts in 3 days')
  })

  test('a challenge starting later today says Starts today', () => {
    const laterToday = iso('2026-05-31T18:00:00')
    expect(challengeTimePhrase(laterToday, end, tz, new Date('2026-05-31T12:00:00'))).toBe('Starts today')
  })

  test('ongoing: ends today / tomorrow / in N days (last included day, end exclusive)', () => {
    // Last included day is 7 Jun.
    expect(challengeTimePhrase(start, end, tz, new Date('2026-06-07T12:00:00'))).toBe('Ends today')
    expect(challengeTimePhrase(start, end, tz, new Date('2026-06-06T12:00:00'))).toBe('Ends tomorrow')
    expect(challengeTimePhrase(start, end, tz, new Date('2026-06-04T12:00:00'))).toBe('Ends in 3 days')
  })

  test('ended names the last included day in the challenge timezone', () => {
    // Hosted in Los Angeles: 1 Jun 00:00 PDT .. 8 Jun 00:00 PDT (exclusive).
    expect(
      challengeTimePhrase(
        '2026-06-01T07:00:00Z',
        '2026-06-08T07:00:00Z',
        'America/Los_Angeles',
        new Date('2026-06-20T12:00:00Z'),
        'en-GB',
      ),
    ).toBe('Ended 7 Jun 2026')
  })
})

describe('challengeRangeLabel', () => {
  test('renders start through last included day', () => {
    expect(challengeRangeLabel(start, end, tz, 'en-GB')).toBe('1 Jun – 7 Jun 2026')
  })

  test('renders in the challenge timezone, not the viewer timezone', () => {
    // Hosted in Los Angeles, last day 7 Jun; end_ts is 8 Jun in UTC and most of
    // Europe, but the host's window reads 1 Jun – 7 Jun.
    expect(
      challengeRangeLabel('2026-06-01T07:00:00Z', '2026-06-08T07:00:00Z', 'America/Los_Angeles', 'en-GB'),
    ).toBe('1 Jun – 7 Jun 2026')
  })

  test('an invalid timezone falls back to the viewer timezone instead of throwing', () => {
    expect(challengeRangeLabel(start, end, 'Not/A_Zone', 'en-GB')).toBe('1 Jun – 7 Jun 2026')
  })
})

describe('groupChallengeItems', () => {
  const spec = {
    aggregation: 'sum' as const,
    bucket_size: 'auto' as const,
    pattern: 'steps',
    source_type: 'metric' as const,
    unit: 'steps',
  }

  const hostedAt = (id: string, startLocal: string, endLocal: string): Challenge => ({
    created_at: iso(startLocal),
    end_ts: iso(endLocal),
    id,
    name: id,
    share_url: `https://example.test/c/${id}`,
    slug: id,
    spec,
    start_ts: iso(startLocal),
    timezone: 'Europe/Stockholm',
    updated_at: iso(startLocal),
    visibility: 'unlisted',
  })

  const joinedAt = (id: string, startLocal: string, endLocal: string): ChallengeParticipation => ({
    challenge_url: `https://example.test/c/${id}`,
    created_at: iso(startLocal),
    end_ts: iso(endLocal),
    host_identity: 'host@example.test',
    id,
    name: id,
    spec,
    start_ts: iso(startLocal),
    status: 'active',
    timezone: 'Europe/Stockholm',
  })

  const now = new Date('2026-06-10T12:00:00')

  test('splits hosted and joined by time status and sorts by relevance', () => {
    const hosted = [
      hostedAt('h-ended', '2026-05-01T00:00:00', '2026-05-08T00:00:00'),
      hostedAt('h-ongoing-long', '2026-06-08T00:00:00', '2026-06-22T00:00:00'),
    ]
    const joined = [
      joinedAt('j-ongoing-short', '2026-06-08T00:00:00', '2026-06-12T00:00:00'),
      joinedAt('j-upcoming-near', '2026-06-15T00:00:00', '2026-06-22T00:00:00'),
      joinedAt('j-upcoming-far', '2026-07-01T00:00:00', '2026-07-08T00:00:00'),
      joinedAt('j-ended-recent', '2026-05-20T00:00:00', '2026-05-27T00:00:00'),
    ]

    const groups = groupChallengeItems(hosted, joined, now)

    // Ongoing: ending soonest first.
    expect(groups.ongoing.map(challengeItemKey)).toEqual(['joined-j-ongoing-short', 'hosted-h-ongoing-long'])
    // Upcoming: starting soonest first.
    expect(groups.upcoming.map(challengeItemKey)).toEqual(['joined-j-upcoming-near', 'joined-j-upcoming-far'])
    // Ended: most recently ended first.
    expect(groups.ended.map(challengeItemKey)).toEqual(['joined-j-ended-recent', 'hosted-h-ended'])
  })

  test('empty inputs give empty groups', () => {
    expect(groupChallengeItems([], [], now)).toEqual({ ended: [], ongoing: [], upcoming: [] })
  })
})
