import { describe, expect, test } from 'vitest'
import type { Scrobble } from '../../state/api'
import {
  buildMusicTooltipHtml,
  getMergeGapMs,
  MELODY,
  mergeScrobblesIntoSessions,
  MUSIC_STAFF_HEIGHT,
  staffPositionToY,
} from './drawMusicStaff'

const makeScrobble = (time: string, artist = 'Artist', track = 'Track', album = 'Album'): Scrobble => ({
  album,
  artist,
  recorded_at: new Date(time),
  track,
})

describe('mergeScrobblesIntoSessions', () => {
  test('returns empty array for no scrobbles', () => {
    expect(mergeScrobblesIntoSessions([], 600_000)).toEqual([])
  })

  test('single scrobble becomes a single session', () => {
    const scrobbles = [makeScrobble('2024-06-15T10:00:00Z')]
    const sessions = mergeScrobblesIntoSessions(scrobbles, 600_000)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.start).toEqual(new Date('2024-06-15T10:00:00Z'))
    // end = recorded_at + 3.5min (210000ms)
    expect(sessions[0]!.end.getTime()).toBe(new Date('2024-06-15T10:00:00Z').getTime() + 210_000)
    expect(sessions[0]!.scrobbles).toHaveLength(1)
  })

  test('merges scrobbles within the gap', () => {
    const scrobbles = [
      makeScrobble('2024-06-15T10:00:00Z', 'A', 'T1'),
      makeScrobble('2024-06-15T10:03:00Z', 'B', 'T2'), // 3min after start, well within track+gap
      makeScrobble('2024-06-15T10:06:00Z', 'C', 'T3'), // 3min after second
    ]
    const sessions = mergeScrobblesIntoSessions(scrobbles, 600_000) // 10min gap

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.scrobbles).toHaveLength(3)
    expect(sessions[0]!.start).toEqual(new Date('2024-06-15T10:00:00Z'))
    // end = last scrobble + 3.5min
    expect(sessions[0]!.end.getTime()).toBe(new Date('2024-06-15T10:06:00Z').getTime() + 210_000)
  })

  test('splits sessions when gap exceeds threshold', () => {
    const scrobbles = [
      makeScrobble('2024-06-15T10:00:00Z', 'A', 'T1'),
      makeScrobble('2024-06-15T10:03:00Z', 'A', 'T2'),
      // Big gap: next scrobble at 11:00, well beyond 10min gap
      makeScrobble('2024-06-15T11:00:00Z', 'B', 'T3'),
    ]
    const sessions = mergeScrobblesIntoSessions(scrobbles, 600_000) // 10min gap

    expect(sessions).toHaveLength(2)
    expect(sessions[0]!.scrobbles).toHaveLength(2)
    expect(sessions[1]!.scrobbles).toHaveLength(1)
    expect(sessions[1]!.start).toEqual(new Date('2024-06-15T11:00:00Z'))
  })

  test('gap is measured from end of previous track to start of next', () => {
    // Track duration = 3.5min = 210000ms
    // Scrobble 1 ends at 10:03:30
    // Scrobble 2 starts at 10:13:00 → gap = 9.5 min (570000ms)
    // With 10min (600000ms) merge gap, they should merge
    const scrobbles = [makeScrobble('2024-06-15T10:00:00Z'), makeScrobble('2024-06-15T10:13:00Z')]
    const sessions = mergeScrobblesIntoSessions(scrobbles, 600_000)
    expect(sessions).toHaveLength(1)

    // But with a 9min gap (540000ms), they should split
    const sessions2 = mergeScrobblesIntoSessions(scrobbles, 540_000)
    expect(sessions2).toHaveLength(2)
  })

  test('handles many sessions', () => {
    const scrobbles = [
      makeScrobble('2024-06-15T10:00:00Z'),
      makeScrobble('2024-06-15T12:00:00Z'),
      makeScrobble('2024-06-15T14:00:00Z'),
    ]
    const sessions = mergeScrobblesIntoSessions(scrobbles, 600_000) // 10min

    expect(sessions).toHaveLength(3)
  })
})

describe('getMergeGapMs', () => {
  test('returns 10 min for zoomed in (>100 px/hr)', () => {
    expect(getMergeGapMs(150)).toBe(10 * 60 * 1000)
    expect(getMergeGapMs(200)).toBe(10 * 60 * 1000)
  })

  test('returns 30 min for medium zoom (20-100 px/hr)', () => {
    expect(getMergeGapMs(50)).toBe(30 * 60 * 1000)
    expect(getMergeGapMs(21)).toBe(30 * 60 * 1000)
  })

  test('returns 2 hours for zoomed out (<= 20 px/hr)', () => {
    expect(getMergeGapMs(20)).toBe(2 * 60 * 60 * 1000)
    expect(getMergeGapMs(5)).toBe(2 * 60 * 60 * 1000)
  })

  test('boundary: exactly 100 px/hr is medium', () => {
    expect(getMergeGapMs(100)).toBe(30 * 60 * 1000)
  })
})

describe('staffPositionToY', () => {
  const staffY = 0

  test('position 0 maps to the middle (3rd) staff line', () => {
    const y = staffPositionToY(staffY, 0)
    // Middle line = staffY + STAFF_TOP_PADDING + 2 * STAFF_LINE_SPACING
    // = 0 + 4 + 12 = 16
    expect(y).toBe(16)
  })

  test('positive positions move upward (lower y)', () => {
    const y0 = staffPositionToY(staffY, 0)
    const y1 = staffPositionToY(staffY, 1)
    const y2 = staffPositionToY(staffY, 2)

    expect(y1).toBeLessThan(y0)
    expect(y2).toBeLessThan(y1)
  })

  test('negative positions move downward (higher y)', () => {
    const y0 = staffPositionToY(staffY, 0)
    const yNeg1 = staffPositionToY(staffY, -1)
    const yNeg2 = staffPositionToY(staffY, -2)

    expect(yNeg1).toBeGreaterThan(y0)
    expect(yNeg2).toBeGreaterThan(yNeg1)
  })

  test('each step moves half a line spacing', () => {
    const y0 = staffPositionToY(staffY, 0)
    const y1 = staffPositionToY(staffY, 1)

    // STAFF_LINE_SPACING = 6, so half = 3
    expect(y0 - y1).toBe(3)
  })

  test('position +4 lands on the top staff line', () => {
    const y = staffPositionToY(staffY, 4)
    // Top line = staffY + STAFF_TOP_PADDING = 0 + 4 = 4
    expect(y).toBe(4)
  })

  test('position -4 lands on the bottom staff line', () => {
    const y = staffPositionToY(staffY, -4)
    // Bottom line = staffY + STAFF_TOP_PADDING + 4 * STAFF_LINE_SPACING = 0 + 4 + 24 = 28
    expect(y).toBe(28)
  })

  test('even positions land on lines, odd positions between lines', () => {
    // Staff lines are at positions -4, -2, 0, +2, +4
    const linePositions = [-4, -2, 0, 2, 4]
    const topLine = staffPositionToY(staffY, 4)

    for (const pos of linePositions) {
      const y = staffPositionToY(staffY, pos)
      // Should be exactly on a staff line (integer multiple of line spacing from top)
      expect((y - topLine) % 6).toBe(0)
    }

    // Odd positions (spaces between lines) should be at half-spacing
    const spacePositions = [-3, -1, 1, 3]
    for (const pos of spacePositions) {
      const y = staffPositionToY(staffY, pos)
      expect((y - topLine) % 6).toBe(3) // half a line spacing off
    }
  })

  test('works with non-zero staffY offset', () => {
    const offset = 50
    const y0base = staffPositionToY(0, 0)
    const y0offset = staffPositionToY(offset, 0)

    expect(y0offset - y0base).toBe(offset)
  })
})

describe('MELODY', () => {
  test('has at least 20 notes', () => {
    expect(MELODY.length).toBeGreaterThanOrEqual(20)
  })

  test('all positions are within reasonable staff range', () => {
    // Should be within [-6, +6] to avoid excessive ledger lines
    for (const pos of MELODY) {
      expect(pos).toBeGreaterThanOrEqual(-6)
      expect(pos).toBeLessThanOrEqual(6)
    }
  })
})

describe('MUSIC_STAFF_HEIGHT', () => {
  test('is large enough for 5 lines plus padding', () => {
    // 5 lines = 4 gaps * 6px + padding above and below
    expect(MUSIC_STAFF_HEIGHT).toBeGreaterThanOrEqual(24 + 4) // at minimum
  })
})

describe('buildMusicTooltipHtml', () => {
  test('includes session time range', () => {
    const html = buildMusicTooltipHtml({
      end: new Date('2024-06-15T11:30:00Z'),
      scrobbles: [makeScrobble('2024-06-15T10:00:00Z')],
      start: new Date('2024-06-15T10:00:00Z'),
    })

    expect(html).toContain('♪ Music')
    expect(html).toContain('1 track')
  })

  test('pluralizes track count', () => {
    const html = buildMusicTooltipHtml({
      end: new Date('2024-06-15T11:30:00Z'),
      scrobbles: [
        makeScrobble('2024-06-15T10:00:00Z', 'A', 'T1'),
        makeScrobble('2024-06-15T10:03:00Z', 'B', 'T2'),
      ],
      start: new Date('2024-06-15T10:00:00Z'),
    })

    expect(html).toContain('2 tracks')
  })

  test('lists all tracks', () => {
    const html = buildMusicTooltipHtml({
      end: new Date('2024-06-15T11:30:00Z'),
      scrobbles: [
        makeScrobble('2024-06-15T10:00:00Z', 'Radiohead', 'Creep'),
        makeScrobble('2024-06-15T10:03:00Z', 'ABBA', 'I Let the Music Speak'),
      ],
      start: new Date('2024-06-15T10:00:00Z'),
    })

    expect(html).toContain('Radiohead – Creep')
    expect(html).toContain('ABBA – I Let the Music Speak')
  })

  test('escapes HTML in track names', () => {
    const html = buildMusicTooltipHtml({
      end: new Date('2024-06-15T11:30:00Z'),
      scrobbles: [makeScrobble('2024-06-15T10:00:00Z', 'AC/DC', '<script>alert("xss")</script>')],
      start: new Date('2024-06-15T10:00:00Z'),
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
