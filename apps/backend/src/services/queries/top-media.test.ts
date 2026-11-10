import type { MediaPlay } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import { getTopMedia, type TopMediaDeps } from './top-media.ts'

const play = (artist: string, title: string, album = ''): MediaPlay => ({
  album,
  artist,
  device: 'laptop',
  ended_at: null,
  id: `${artist}/${title}`,
  kind: 'music',
  max_position_secs: null,
  played_ratio: null,
  played_secs: null,
  player: 'lastfm',
  seek_count: null,
  source: 'lastfm',
  started_at: '2026-10-02T10:00:00.000Z',
  title,
  track_secs: null,
  url: '',
})

const deps = (plays: MediaPlay[]): TopMediaDeps => ({ getMediaPlays: vi.fn().mockResolvedValue(plays) })

const window = { end: new Date('2026-11-01T00:00:00Z'), start: new Date('2026-10-01T00:00:00Z') }

const plays = [
  play('Bach', 'Toccata', 'Organ Works'),
  play('Bach', 'Fugue', 'Organ Works'),
  play('Bach', 'Toccata', 'Organ Works'),
  play('Satie', 'Gymnopédie No. 1', 'Piano'),
  play('Arvo Pärt', 'Spiegel im Spiegel'),
  play('', 'Unknown jingle'),
]

describe('getTopMedia', () => {
  test('ranks artists by plays, counting the plays without an artist in the total only', async () => {
    const d = deps(plays)

    const top = await getTopMedia('u', window, 'artist', 2, undefined, d)

    expect(top).toEqual({
      distinct: 3,
      items: [
        { name: 'Bach', plays: 3 },
        { name: 'Arvo Pärt', plays: 1 },
      ],
      total_plays: 6,
    })
    expect(d.getMediaPlays).toHaveBeenCalledWith('u', window, { source: undefined })
  })

  test('passes the source filter to the play query', async () => {
    const d = deps(plays)

    await getTopMedia('u', window, 'artist', 3, 'lastfm', d)

    expect(d.getMediaPlays).toHaveBeenCalledWith('u', window, { source: 'lastfm' })
  })

  test('groups albums under their artist and skips plays without an album', async () => {
    const top = await getTopMedia('u', window, 'album', 10, undefined, deps(plays))

    expect(top).toEqual({
      distinct: 2,
      items: [
        { name: 'Bach — Organ Works', plays: 3 },
        { name: 'Satie — Piano', plays: 1 },
      ],
      total_plays: 6,
    })
  })

  test('groups tracks under their artist', async () => {
    const top = await getTopMedia('u', window, 'track', 1, undefined, deps(plays))

    expect(top.items).toEqual([{ name: 'Bach — Toccata', plays: 2 }])
    expect(top.distinct).toBe(5)
  })

  test('is empty without plays', async () => {
    expect(await getTopMedia('u', window, 'artist', 3, undefined, deps([]))).toEqual({
      distinct: 0,
      items: [],
      total_plays: 0,
    })
  })
})
