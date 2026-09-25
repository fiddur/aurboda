import type { MediaCondition, MediaPlay } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  dedupeAgainstLastfm,
  deriveMediaKind,
  matchesMediaCondition,
  mergeRuleUpdate,
  mprisRecordToPlay,
  pickLongestPlay,
  playedRatio,
  playRange,
  scrobbleRecordToPlay,
  stripTitle,
  validateOutputMediaField,
} from './media-plays.ts'

const mpris = (overrides: Partial<MediaPlay> = {}): MediaPlay => ({
  album: '',
  artist: 'Portishead',
  device: 'laptop',
  ended_at: '2026-01-10T10:04:00.000Z',
  id: 'm1',
  kind: null,
  max_position_secs: 240,
  played_ratio: 1,
  played_secs: 240,
  player: 'firefox',
  seek_count: 0,
  source: 'mpris',
  started_at: '2026-01-10T10:00:00.000Z',
  title: 'Roads',
  track_secs: 240,
  url: 'https://www.youtube.com/watch?v=abc',
  ...overrides,
})

const scrobble = (overrides: Partial<MediaPlay> = {}): MediaPlay =>
  ({
    ...scrobbleRecordToPlay('s1', new Date('2026-01-10T10:02:00.000Z'), {
      album: 'Dummy',
      artist: 'Portishead',
      track: 'Roads',
    }),
    ...overrides,
  }) as MediaPlay

const cond = (overrides: Partial<MediaCondition> = {}): MediaCondition => ({
  kind: 'media',
  match_mode: 'contains',
  ...overrides,
})

const yogaTitle = 'Yin Yoga for Healthy Hips with Meagan — True Naked Yoga'

describe('playedRatio', () => {
  test('divides played by track seconds', () => {
    expect(playedRatio(900, 1800)).toBe(0.5)
  })

  test('is null when either is unknown or track is zero', () => {
    expect(playedRatio(900, null)).toBeNull()
    expect(playedRatio(null, 1800)).toBeNull()
    expect(playedRatio(900, 0)).toBeNull()
  })
})

describe('deriveMediaKind', () => {
  test('Last.fm plays are music, MPRIS plays unknown', () => {
    expect(deriveMediaKind({ source: 'lastfm' })).toBe('music')
    expect(deriveMediaKind({ source: 'mpris' })).toBeNull()
  })
})

describe('record mapping', () => {
  test('mpris record keeps nullable track_secs and computes ratio', () => {
    const play = mprisRecordToPlay('p1', {
      album: '',
      artist: '',
      device: 'laptop',
      ended_at: '2026-01-10T10:30:00.000Z',
      max_position_secs: 1700,
      played_secs: 1700,
      player: 'mpv',
      seek_count: 1,
      started_at: '2026-01-10T10:00:00.000Z',
      title: 'Talk',
      track_secs: null,
      url: '',
    })
    expect(play).toMatchObject({
      id: 'p1',
      kind: null,
      played_ratio: null,
      source: 'mpris',
      track_secs: null,
    })
  })

  test('scrobble maps track to title with null play stats', () => {
    expect(scrobble()).toMatchObject({
      ended_at: null,
      kind: 'music',
      played_secs: null,
      source: 'lastfm',
      started_at: '2026-01-10T10:02:00.000Z',
      title: 'Roads',
      url: '',
    })
  })
})

describe('dedupeAgainstLastfm', () => {
  test('drops a scrobble of the same track within five minutes', () => {
    expect(dedupeAgainstLastfm([mpris()], [scrobble()]).map((p) => p.id)).toEqual(['m1'])
  })

  test('keeps a scrobble more than five minutes away', () => {
    const late = scrobble({ started_at: '2026-01-10T10:05:01.000Z' })
    expect(dedupeAgainstLastfm([mpris()], [late]).map((p) => p.id)).toEqual(['m1', 's1'])
  })

  test('an mpris play without artist never matches', () => {
    expect(dedupeAgainstLastfm([mpris({ artist: '' })], [scrobble()])).toHaveLength(2)
  })

  test('comparison ignores case and surrounding whitespace', () => {
    const play = mpris({ artist: '  portishead ', title: 'ROADS ' })
    expect(dedupeAgainstLastfm([play], [scrobble()]).map((p) => p.id)).toEqual(['m1'])
  })

  test('result does not depend on which arrived first', () => {
    const other = scrobble({ id: 's2', started_at: '2026-01-10T09:00:00.000Z', title: 'Glory Box' })
    const a = dedupeAgainstLastfm([mpris()], [scrobble(), other])
    const b = dedupeAgainstLastfm([mpris()], [other, scrobble()])
    expect(a).toEqual(b)
    expect(a.map((p) => p.id)).toEqual(['s2', 'm1'])
  })
})

describe('playRange', () => {
  test('uses ended_at, or one minute for plays without one', () => {
    expect(playRange(mpris()).end.toISOString()).toBe('2026-01-10T10:04:00.000Z')
    expect(playRange(scrobble()).end.toISOString()).toBe('2026-01-10T10:03:00.000Z')
  })
})

describe('matchesMediaCondition', () => {
  const yoga = mpris({
    artist: '',
    played_ratio: 0.95,
    played_secs: 1710,
    title: yogaTitle,
    track_secs: 1800,
    url: 'https://www.truenakedyoga.com/videos/yin-hips',
  })

  test('url_host matches the host and its subdomains', () => {
    expect(matchesMediaCondition(yoga, cond({ url_host: ['truenakedyoga.com'] }))).toBe(true)
    expect(matchesMediaCondition(yoga, cond({ url_host: ['WWW.TrueNakedYoga.com'] }))).toBe(true)
  })

  test('url_host does not match a host that merely ends with the name', () => {
    const lookalike = { ...yoga, url: 'https://nottruenakedyoga.com/x' }
    expect(matchesMediaCondition(lookalike, cond({ url_host: ['truenakedyoga.com'] }))).toBe(false)
  })

  test('url_host never matches an empty or unparsable url', () => {
    expect(matchesMediaCondition({ ...yoga, url: '' }, cond({ url_host: ['truenakedyoga.com'] }))).toBe(false)
    expect(matchesMediaCondition({ ...yoga, url: 'not a url' }, cond({ url_host: ['x.com'] }))).toBe(false)
  })

  test('title contains vs exact', () => {
    expect(matchesMediaCondition(yoga, cond({ title: 'yin yoga' }))).toBe(true)
    expect(matchesMediaCondition(yoga, cond({ match_mode: 'exact', title: 'yin yoga' }))).toBe(false)
    expect(matchesMediaCondition(yoga, cond({ match_mode: 'exact', title: yogaTitle.toUpperCase() }))).toBe(
      true,
    )
  })

  test('artist matches any of the given names', () => {
    expect(matchesMediaCondition(mpris(), cond({ artist: ['Massive Attack', 'portis'] }))).toBe(true)
    expect(matchesMediaCondition(mpris(), cond({ artist: ['Massive Attack'] }))).toBe(false)
  })

  test('player matches exactly, case-insensitive', () => {
    expect(matchesMediaCondition(mpris(), cond({ player: ['Firefox'] }))).toBe(true)
    expect(matchesMediaCondition(mpris(), cond({ player: ['fire'] }))).toBe(false)
  })

  test('min_played_secs fails plays without played_secs', () => {
    expect(matchesMediaCondition(yoga, cond({ min_played_secs: 600 }))).toBe(true)
    expect(matchesMediaCondition(scrobble(), cond({ min_played_secs: 1 }))).toBe(false)
  })

  test('min_played_ratio is skipped when the track length is unknown', () => {
    const noLength = { ...yoga, played_ratio: null, track_secs: null }
    expect(matchesMediaCondition(noLength, cond({ min_played_ratio: 0.8 }))).toBe(true)
    expect(matchesMediaCondition(scrobble(), cond({ min_played_ratio: 0.8 }))).toBe(true)
  })

  test('a skim fails both thresholds', () => {
    const skim = { ...yoga, played_ratio: playedRatio(40, 1800), played_secs: 40 }
    expect(matchesMediaCondition(skim, cond({ min_played_ratio: 0.8 }))).toBe(false)
    expect(matchesMediaCondition(skim, cond({ min_played_secs: 600 }))).toBe(false)
  })

  test('all matchers must hold', () => {
    expect(matchesMediaCondition(yoga, cond({ player: ['mpv'], url_host: ['truenakedyoga.com'] }))).toBe(
      false,
    )
  })
})

describe('stripTitle', () => {
  test('removes the site suffix from the issue example', () => {
    expect(stripTitle(yogaTitle, '\\s*—\\s*True Naked Yoga$')).toBe('Yin Yoga for Healthy Hips with Meagan')
  })

  test('removes every match and collapses whitespace', () => {
    expect(stripTitle('  a [HD]  b [hd] ', '\\[hd\\]')).toBe('a b')
  })

  test('without a pattern only trims', () => {
    expect(stripTitle('  Roads ')).toBe('Roads')
  })
})

describe('pickLongestPlay', () => {
  const window = [{ end: new Date('2026-01-10T11:00:00Z'), start: new Date('2026-01-10T10:00:00Z') }]

  test('picks the play with most played seconds', () => {
    const short = mpris({ id: 'short', played_secs: 100 })
    const long = mpris({
      ended_at: '2026-01-10T10:25:00.000Z',
      id: 'long',
      played_secs: 900,
      started_at: '2026-01-10T10:10:00.000Z',
    })
    expect(pickLongestPlay([short, long], window)?.id).toBe('long')
  })

  test('ties go to the earliest start', () => {
    const a = mpris({ id: 'a', started_at: '2026-01-10T10:01:00.000Z' })
    const b = mpris({ id: 'b', started_at: '2026-01-10T10:00:30.000Z' })
    expect(pickLongestPlay([a, b], window)?.id).toBe('b')
  })

  test('ignores plays outside the windows', () => {
    const outside = mpris({ ended_at: '2026-01-10T09:30:00.000Z', started_at: '2026-01-10T09:00:00.000Z' })
    expect(pickLongestPlay([outside], window)).toBeNull()
  })

  test('plays without played_secs score their overlap', () => {
    expect(pickLongestPlay([scrobble()], window)?.id).toBe('s1')
  })
})

describe('validateOutputMediaField', () => {
  const media = cond({ url_host: ['truenakedyoga.com'] })
  const field = { field: 'session_name', strip_pattern: '\\s*—.*$' }

  test('accepts enrich rules with a media condition', () => {
    expect(
      validateOutputMediaField({ conditions: [media], mode: 'enrich', output_media_field: field }),
    ).toBeNull()
  })

  test('accepts rules without output_media_field', () => {
    expect(validateOutputMediaField({ conditions: [media], mode: 'create' })).toBeNull()
  })

  test('rejects create mode', () => {
    expect(validateOutputMediaField({ conditions: [media], output_media_field: field })).toMatch(/enrich/)
  })

  test('rejects rules without a media condition', () => {
    expect(
      validateOutputMediaField({
        conditions: [{ activity_type: 'yoga', kind: 'activity' }],
        mode: 'enrich',
        output_media_field: field,
      }),
    ).toMatch(/media/)
  })

  test('rejects a strip_pattern that does not compile', () => {
    expect(
      validateOutputMediaField({
        conditions: [media],
        mode: 'enrich',
        output_media_field: { field: 'session_name', strip_pattern: '(' },
      }),
    ).toMatch(/strip_pattern/)
  })

  test('mergeRuleUpdate applies partial updates, null clearing the field', () => {
    const existing = { conditions: [media], mode: 'enrich', output_media_field: field }
    expect(mergeRuleUpdate(existing, { mode: 'create' })).toEqual({ ...existing, mode: 'create' })
    expect(mergeRuleUpdate(existing, { output_media_field: null }).output_media_field).toBeNull()
  })
})
