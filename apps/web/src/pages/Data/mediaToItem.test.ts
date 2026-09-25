import { describe, expect, test } from 'vitest'

import type { MediaPlay } from '../../state/api'

import { MEDIA_COLOR, mediaToItem } from './mediaToItem'

const started = new Date(2026, 0, 10, 10, 2)
const ended = new Date(2026, 0, 10, 10, 32)

const mpris = (overrides: Partial<MediaPlay> = {}): MediaPlay => ({
  album: '',
  artist: '',
  device: 'laptop',
  ended_at: ended,
  id: 'p1',
  kind: null,
  max_position_secs: 1800,
  played_ratio: 0.99,
  played_secs: 1740,
  player: 'firefox',
  seek_count: 0,
  source: 'mpris',
  started_at: started,
  title: 'Yin Yoga for Healthy Hips',
  track_secs: 1760,
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

describe('mediaToItem', () => {
  test('an MPRIS play shows played time, ratio and player, and links to its url', () => {
    expect(mediaToItem(mpris(), false)).toEqual({
      color: MEDIA_COLOR,
      detail: '10:02 · 29m played (99%) · firefox',
      end: ended,
      href: 'https://www.truenakedyoga.com/videos/yin-hips',
      label: 'Yin Yoga for Healthy Hips',
      start: started,
      type: 'media',
    })
  })

  test('a Last.fm scrobble reads as time · artist with the track as label', () => {
    expect(mediaToItem(scrobble, false)).toEqual({
      color: MEDIA_COLOR,
      detail: '10:02 · Portishead',
      end: undefined,
      href: undefined,
      label: 'Roads',
      start: started,
      type: 'media',
    })
  })

  test('includes the artist when present and formats short and long plays', () => {
    expect(mediaToItem(mpris({ artist: 'Meagan', played_ratio: 0.02, played_secs: 40 }), false).detail).toBe(
      '10:02 · Meagan · 40s played (2%) · firefox',
    )
    expect(mediaToItem(mpris({ played_ratio: null, played_secs: 5400 }), false).detail).toBe(
      '10:02 · 1h 30m played · firefox',
    )
  })

  test('prefixes the date when the view spans several days', () => {
    expect(mediaToItem(scrobble, true).detail).toBe('Jan 10 10:02 · Portishead')
  })

  test('falls back to the url, then Untitled, for the label', () => {
    expect(mediaToItem(mpris({ title: '' }), false).label).toBe(
      'https://www.truenakedyoga.com/videos/yin-hips',
    )
    expect(mediaToItem(mpris({ title: '', url: '' }), false).label).toBe('Untitled')
  })

  test('links only http(s) urls', () => {
    expect(mediaToItem(mpris({ url: 'file:///home/me/video.mkv' }), false).href).toBeUndefined()
  })
})
