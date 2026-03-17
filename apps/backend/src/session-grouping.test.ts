/**
 * Session grouping utility tests.
 */

import { describe, expect, it } from 'vitest'

import { groupIntoSessions, type TimestampedEvent } from './session-grouping.ts'

const event = (isoTime: string): TimestampedEvent => ({ timestamp: new Date(isoTime) })

describe('groupIntoSessions', () => {
  it('returns empty array for empty input', () => {
    expect(groupIntoSessions([], 600_000)).toEqual([])
  })

  it('returns single session for single event', () => {
    const events = [event('2024-01-15T10:00:00Z')]
    const sessions = groupIntoSessions(events, 600_000)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].events).toHaveLength(1)
    expect(sessions[0].startTime).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(sessions[0].endTime).toEqual(new Date('2024-01-15T10:00:00Z'))
  })

  it('groups events within maxGapMs into one session', () => {
    const events = [
      event('2024-01-15T10:00:00Z'),
      event('2024-01-15T10:04:00Z'), // 4 min gap
      event('2024-01-15T10:08:00Z'), // 4 min gap
    ]
    const sessions = groupIntoSessions(events, 600_000) // 10 min gap

    expect(sessions).toHaveLength(1)
    expect(sessions[0].events).toHaveLength(3)
    expect(sessions[0].startTime).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(sessions[0].endTime).toEqual(new Date('2024-01-15T10:08:00Z'))
  })

  it('splits into separate sessions when gap exceeds maxGapMs', () => {
    const events = [
      event('2024-01-15T10:00:00Z'),
      event('2024-01-15T10:04:00Z'), // 4 min gap (same session)
      event('2024-01-15T11:00:00Z'), // 56 min gap (new session)
    ]
    const sessions = groupIntoSessions(events, 600_000) // 10 min gap

    expect(sessions).toHaveLength(2)
    expect(sessions[0].events).toHaveLength(2)
    expect(sessions[0].startTime).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(sessions[0].endTime).toEqual(new Date('2024-01-15T10:04:00Z'))
    expect(sessions[1].events).toHaveLength(1)
    expect(sessions[1].startTime).toEqual(new Date('2024-01-15T11:00:00Z'))
    expect(sessions[1].endTime).toEqual(new Date('2024-01-15T11:00:00Z'))
  })

  it('handles mixed gaps correctly', () => {
    const events = [
      event('2024-01-15T10:00:00Z'),
      event('2024-01-15T10:03:00Z'), // 3 min (same session)
      event('2024-01-15T10:06:00Z'), // 3 min (same session)
      event('2024-01-15T11:00:00Z'), // 54 min (new session)
      event('2024-01-15T11:05:00Z'), // 5 min (same session)
      event('2024-01-15T12:00:00Z'), // 55 min (new session)
    ]
    const sessions = groupIntoSessions(events, 600_000) // 10 min gap

    expect(sessions).toHaveLength(3)
    expect(sessions[0].events).toHaveLength(3)
    expect(sessions[1].events).toHaveLength(2)
    expect(sessions[2].events).toHaveLength(1)
  })

  it('treats gap exactly equal to maxGapMs as same session', () => {
    const events = [
      event('2024-01-15T10:00:00Z'),
      event('2024-01-15T10:10:00Z'), // exactly 10 min gap
    ]
    const sessions = groupIntoSessions(events, 600_000) // 10 min gap

    expect(sessions).toHaveLength(1)
    expect(sessions[0].events).toHaveLength(2)
  })

  it('preserves event data in sessions', () => {
    interface ScrobbleEvent extends TimestampedEvent {
      readonly artist: string
    }
    const events: ScrobbleEvent[] = [
      { artist: 'Artist A', timestamp: new Date('2024-01-15T10:00:00Z') },
      { artist: 'Artist B', timestamp: new Date('2024-01-15T10:04:00Z') },
    ]
    const sessions = groupIntoSessions(events, 600_000)

    expect(sessions[0].events[0].artist).toBe('Artist A')
    expect(sessions[0].events[1].artist).toBe('Artist B')
  })
})
