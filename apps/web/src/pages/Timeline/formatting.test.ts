import { describe, expect, it } from 'vitest'

import type { Activity } from '../../state/api'

import { escapeHtml, formatDuration, formatExerciseType, formatTime, getExerciseTypeName } from './formatting'

describe('formatTime', () => {
  it('formats date as HH:mm', () => {
    expect(formatTime(new Date('2026-01-01T08:05:00'))).toBe('08:05')
  })

  it('formats midnight', () => {
    expect(formatTime(new Date('2026-01-01T00:00:00'))).toBe('00:00')
  })
})

describe('formatDuration', () => {
  const base = new Date('2026-01-01T08:00:00Z')

  it('formats minutes only for < 1 hour', () => {
    expect(formatDuration(base, new Date('2026-01-01T08:30:00Z'))).toBe('30m')
  })

  it('formats hours only for exact hours', () => {
    expect(formatDuration(base, new Date('2026-01-01T10:00:00Z'))).toBe('2h')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(base, new Date('2026-01-01T09:15:00Z'))).toBe('1h 15m')
  })

  it('handles zero duration', () => {
    expect(formatDuration(base, base)).toBe('0m')
  })
})

describe('formatExerciseType', () => {
  it('replaces underscores with spaces', () => {
    expect(formatExerciseType('indoor_cycling')).toBe('indoor cycling')
  })

  it('handles no underscores', () => {
    expect(formatExerciseType('Running')).toBe('Running')
  })
})

describe('getExerciseTypeName', () => {
  it('returns title when no exercise data', () => {
    const activity = { title: 'Morning Run' } as Activity
    expect(getExerciseTypeName(activity)).toBe('Morning Run')
  })

  it('returns Workout as fallback', () => {
    const activity = {} as Activity
    expect(getExerciseTypeName(activity)).toBe('Workout')
  })

  it('uses exerciseTypeName from data', () => {
    const activity = { data: { exerciseTypeName: 'indoor_cycling' } } as unknown as Activity
    expect(getExerciseTypeName(activity)).toBe('indoor cycling')
  })
})

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('handles combined special characters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('returns plain strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})
