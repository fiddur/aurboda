import { describe, expect, test } from 'vitest'

import type { Scrobble } from '../../state/api'

import { findOverlappingScrobbles } from './findOverlappingScrobbles'

describe('findOverlappingScrobbles', () => {
  test('returns empty array when no scrobbles', () => {
    expect(
      findOverlappingScrobbles([], new Date('2024-06-15T10:00:00Z'), new Date('2024-06-15T11:00:00Z')),
    ).toEqual([])
  })

  test('returns artist – track for overlapping scrobble', () => {
    const scrobbles: Scrobble[] = [
      {
        album: 'Kid A',
        artist: 'Radiohead',
        recorded_at: new Date('2024-06-15T10:30:00Z'),
        track: 'Idioteque',
      },
    ]

    const result = findOverlappingScrobbles(
      scrobbles,
      new Date('2024-06-15T10:00:00Z'),
      new Date('2024-06-15T11:00:00Z'),
    )

    expect(result).toEqual(['Radiohead – Idioteque'])
  })

  test('excludes scrobbles outside the time range', () => {
    const scrobbles: Scrobble[] = [
      {
        album: 'Album',
        artist: 'Artist',
        recorded_at: new Date('2024-06-15T09:00:00Z'),
        track: 'Early Track',
      },
      {
        album: 'Album',
        artist: 'Artist',
        recorded_at: new Date('2024-06-15T12:00:00Z'),
        track: 'Late Track',
      },
    ]

    const result = findOverlappingScrobbles(
      scrobbles,
      new Date('2024-06-15T10:00:00Z'),
      new Date('2024-06-15T11:00:00Z'),
    )

    expect(result).toEqual([])
  })

  test('includes scrobble that starts just before range but track duration overlaps', () => {
    // Track starts at 09:58, duration ~3.5 min, so ends at ~10:01:30 — overlaps with range starting at 10:00
    const scrobbles: Scrobble[] = [
      {
        album: 'Album',
        artist: 'Artist',
        recorded_at: new Date('2024-06-15T09:58:00Z'),
        track: 'Overlap Track',
      },
    ]

    const result = findOverlappingScrobbles(
      scrobbles,
      new Date('2024-06-15T10:00:00Z'),
      new Date('2024-06-15T11:00:00Z'),
    )

    expect(result).toEqual(['Artist – Overlap Track'])
  })

  test('excludes scrobble whose duration ends before range starts', () => {
    // Track starts at 09:50, duration ~3.5 min, ends at ~09:53:30 — no overlap with 10:00+
    const scrobbles: Scrobble[] = [
      {
        album: 'Album',
        artist: 'Artist',
        recorded_at: new Date('2024-06-15T09:50:00Z'),
        track: 'No Overlap',
      },
    ]

    const result = findOverlappingScrobbles(
      scrobbles,
      new Date('2024-06-15T10:00:00Z'),
      new Date('2024-06-15T11:00:00Z'),
    )

    expect(result).toEqual([])
  })

  test('returns multiple overlapping scrobbles', () => {
    const scrobbles: Scrobble[] = [
      { album: 'A1', artist: 'Artist A', recorded_at: new Date('2024-06-15T10:10:00Z'), track: 'Track 1' },
      { album: 'A2', artist: 'Artist B', recorded_at: new Date('2024-06-15T10:20:00Z'), track: 'Track 2' },
      { album: 'A3', artist: 'Artist C', recorded_at: new Date('2024-06-15T12:00:00Z'), track: 'Track 3' },
    ]

    const result = findOverlappingScrobbles(
      scrobbles,
      new Date('2024-06-15T10:00:00Z'),
      new Date('2024-06-15T11:00:00Z'),
    )

    expect(result).toEqual(['Artist A – Track 1', 'Artist B – Track 2'])
  })
})
