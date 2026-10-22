import { describe, expect, test } from 'vitest'

import type { Activity, MediaPlay } from '../../state/api'

import {
  activitiesDuringPlay,
  activitiesFetchWindow,
  buildMediaPlayFields,
  formatSecs,
  isWebUrl,
  mediaPlayHeading,
  mediaPlayRange,
} from './mediaPlayFields'

const started = new Date(2026, 0, 10, 10, 2)
const ended = new Date(2026, 0, 10, 10, 32)

const mpris = (overrides: Partial<MediaPlay> = {}): MediaPlay => ({
  album: '',
  artist: '',
  device: 'laptop',
  ended_at: ended,
  id: 'p1',
  kind: null,
  max_position_secs: 1790,
  played_ratio: 0.95,
  played_secs: 1782,
  player: 'firefox',
  seek_count: 2,
  source: 'mpris',
  started_at: started,
  title: 'Yin Yoga for Healthy Hips',
  track_secs: 1876,
  url: 'https://www.truenakedyoga.com/videos/yin-hips',
  ...overrides,
})

const scrobble: MediaPlay = {
  album: 'Dummy',
  artist: 'Portishead',
  device: '',
  id: 's1',
  kind: 'music',
  max_position_secs: null,
  played_ratio: null,
  played_secs: null,
  player: '',
  seek_count: null,
  source: 'lastfm',
  started_at: started,
  title: 'Roads',
  track_secs: null,
  url: '',
}

const activity = (overrides: Partial<Activity>): Activity => ({
  activity_type: 'yoga',
  id: 'a1',
  start_time: new Date(2026, 0, 10, 10, 0),
  ...overrides,
})

describe('formatSecs', () => {
  test('formats seconds, minutes and hours', () => {
    expect(formatSecs(42)).toBe('42s')
    expect(formatSecs(1782)).toBe('29m 42s')
    expect(formatSecs(1800)).toBe('30m')
    expect(formatSecs(5400)).toBe('1h 30m')
    expect(formatSecs(7200)).toBe('2h')
  })
})

describe('mediaPlayHeading', () => {
  test('uses the title, with artist · album as subtitle', () => {
    expect(mediaPlayHeading(scrobble)).toEqual({ subtitle: 'Portishead · Dummy', title: 'Roads' })
  })

  test('falls back to the url, then Untitled, and omits an empty subtitle', () => {
    expect(mediaPlayHeading(mpris({ title: '' }))).toEqual({
      subtitle: undefined,
      title: 'https://www.truenakedyoga.com/videos/yin-hips',
    })
    expect(mediaPlayHeading(mpris({ title: '', url: '' })).title).toBe('Untitled')
  })
})

describe('buildMediaPlayFields', () => {
  test('lists every known field of an MPRIS play', () => {
    expect(buildMediaPlayFields(mpris())).toEqual([
      { label: 'Source', value: 'MPRIS' },
      { label: 'Player', value: 'firefox' },
      { label: 'Device', value: 'laptop' },
      { label: 'Started', value: '2026-01-10 10:02' },
      { label: 'Ended', value: '2026-01-10 10:32' },
      { label: 'Played', value: '29m 42s' },
      { label: 'Track length', value: '31m 16s' },
      { label: 'Played ratio', value: '95%' },
      { label: 'Max position', value: '29m 50s' },
      { label: 'Seeks', value: '2' },
    ])
  })

  test('omits unknown and empty fields of a Last.fm scrobble', () => {
    expect(buildMediaPlayFields(scrobble)).toEqual([
      { label: 'Source', value: 'Last.fm' },
      { label: 'Kind', value: 'music' },
      { label: 'Started', value: '2026-01-10 10:02' },
    ])
  })

  test('keeps a zero seek count', () => {
    expect(buildMediaPlayFields(mpris({ seek_count: 0 }))).toContainEqual({ label: 'Seeks', value: '0' })
  })
})

describe('isWebUrl', () => {
  test('accepts only http(s) urls', () => {
    expect(isWebUrl('https://example.com')).toBe(true)
    expect(isWebUrl('HTTP://example.com')).toBe(true)
    expect(isWebUrl('file:///home/me/video.mkv')).toBe(false)
    expect(isWebUrl('')).toBe(false)
  })
})

describe('mediaPlayRange', () => {
  test('uses ended_at, or a minute after the start when unknown', () => {
    expect(mediaPlayRange(mpris())).toEqual({ end: ended, start: started })
    expect(mediaPlayRange(scrobble)).toEqual({ end: new Date(2026, 0, 10, 10, 3), start: started })
  })
})

describe('activitiesFetchWindow', () => {
  test('reaches back a day before the play and ends with it', () => {
    expect(activitiesFetchWindow(mpris())).toEqual({ end: ended, start: new Date(2026, 0, 9, 10, 2) })
    expect(activitiesFetchWindow(scrobble)).toEqual({
      end: new Date(2026, 0, 10, 10, 3),
      start: new Date(2026, 0, 9, 10, 2),
    })
  })
})

describe('activitiesDuringPlay', () => {
  test('keeps overlapping activities sorted by start, dropping scrobbles, screen time and others', () => {
    const yoga = activity({ end_time: new Date(2026, 0, 10, 10, 35), id: 'yoga' })
    const meditation = activity({
      activity_type: 'meditation',
      end_time: new Date(2026, 0, 10, 10, 40),
      id: 'med',
      start_time: new Date(2026, 0, 10, 10, 30),
    })
    const before = activity({ end_time: new Date(2026, 0, 10, 10, 1), id: 'before' })
    const after = activity({ id: 'after', start_time: new Date(2026, 0, 10, 10, 32) })
    const scrobbleActivity = activity({ activity_type: 'music_scrobble', id: 'scr', start_time: started })
    const screentime = activity({
      activity_type: 'screentime',
      end_time: ended,
      id: 'st',
      start_time: started,
    })

    expect(
      activitiesDuringPlay([meditation, before, after, scrobbleActivity, screentime, yoga], mpris()).map(
        (a) => a.id,
      ),
    ).toEqual(['yoga', 'med'])
  })

  test('counts an activity without an end as an instant', () => {
    const instant = activity({ id: 'instant', start_time: new Date(2026, 0, 10, 10, 2, 30) })
    expect(activitiesDuringPlay([instant], scrobble).map((a) => a.id)).toEqual(['instant'])
  })

  test('keeps an activity that started before the play (#1167)', () => {
    const yoga = activity({ end_time: new Date(2026, 0, 10, 10, 35), id: 'yoga' })
    const meditation = activity({
      activity_type: 'meditation',
      end_time: new Date(2026, 0, 10, 10, 45),
      id: 'med',
      start_time: new Date(2026, 0, 10, 10, 30),
    })
    expect(activitiesDuringPlay([meditation, yoga], mpris()).map((a) => a.id)).toEqual(['yoga', 'med'])
  })

  test('excludes an activity ending exactly when the play starts', () => {
    const touching = activity({ end_time: started, id: 'touching' })
    expect(activitiesDuringPlay([touching], mpris())).toEqual([])
  })
})
