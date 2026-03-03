import { describe, expect, test } from 'vitest'
import type { Scrobble } from '../../state/api'
import { categorizeMusic } from './categorizeMusic'

describe('categorizeMusic', () => {
  test('returns empty array for empty scrobbles', () => {
    expect(categorizeMusic([])).toEqual([])
  })

  test('converts a scrobble to a chart item with artist – track label', () => {
    const scrobbles: Scrobble[] = [
      {
        album: 'Kid A',
        artist: 'Radiohead',
        recorded_at: new Date('2024-06-15T10:00:00Z'),
        track: 'Everything In Its Right Place',
      },
    ]

    const result = categorizeMusic(scrobbles)

    expect(result).toHaveLength(1)
    expect(result[0]!.label).toBe('Radiohead – Everything In Its Right Place')
    expect(result[0]!.column).toBe('Music')
    expect(result[0]!.color).toBe('#ec4899')
    expect(result[0]!.isPoint).toBe(false)
    expect(result[0]!.start).toEqual(new Date('2024-06-15T10:00:00Z'))
    // ~3.5 min = 210000ms
    expect(result[0]!.end.getTime() - result[0]!.start.getTime()).toBe(210000)
  })

  test('creates tooltip with time and album info', () => {
    const scrobbles: Scrobble[] = [
      {
        album: 'The Campfire Headphase',
        artist: 'Boards of Canada',
        recorded_at: new Date('2024-06-15T14:30:00Z'),
        track: 'Dayvan Cowboy',
      },
    ]

    const result = categorizeMusic(scrobbles)

    expect(result[0]!.tooltip.title).toBe('Boards of Canada – Dayvan Cowboy')
    expect(result[0]!.tooltip.details).toContain('The Campfire Headphase')
  })

  test('handles scrobble without album', () => {
    const scrobbles: Scrobble[] = [
      {
        album: '',
        artist: 'Unknown Artist',
        recorded_at: new Date('2024-06-15T10:00:00Z'),
        track: 'Some Track',
      },
    ]

    const result = categorizeMusic(scrobbles)

    expect(result[0]!.tooltip.details).not.toContain('')
  })

  test('handles multiple scrobbles', () => {
    const scrobbles: Scrobble[] = [
      {
        album: 'Album 1',
        artist: 'Artist A',
        recorded_at: new Date('2024-06-15T10:00:00Z'),
        track: 'Track 1',
      },
      {
        album: 'Album 2',
        artist: 'Artist B',
        recorded_at: new Date('2024-06-15T10:05:00Z'),
        track: 'Track 2',
      },
    ]

    const result = categorizeMusic(scrobbles)

    expect(result).toHaveLength(2)
    expect(result[0]!.label).toBe('Artist A – Track 1')
    expect(result[1]!.label).toBe('Artist B – Track 2')
  })
})
