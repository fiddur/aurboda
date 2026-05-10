import { describe, expect, test } from 'vitest'

import type { Activity } from '../types.ts'

import { mergeOverlappingActivities } from './merge.ts'

const garmin = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'meditation',
  end_time: new Date('2026-05-05T10:30:00Z'),
  id: 'garmin-id',
  source: 'garmin',
  start_time: new Date('2026-05-05T10:00:00Z'),
  title: 'Meditation',
  ...overrides,
})

const override = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'pipe_ceremony',
  end_time: new Date('2026-05-05T10:20:00Z'), // narrower than source
  id: 'aurboda-id',
  notes: 'override notes',
  overrides_id: 'garmin-id',
  source: 'aurboda',
  start_time: new Date('2026-05-05T10:05:00Z'), // narrower than source
  title: 'Pipe ceremony',
  ...overrides,
})

const categoryMap = new Map<string, string>([
  ['meditation', 'meditation'],
  ['pipe_ceremony', 'wellness'],
])

describe('mergeOverlappingActivities — aurboda override semantics (#732 follow-up)', () => {
  test('override winner uses its own start/end times — not the source span', () => {
    // Daily summary bug: source's wider time window was leaking into the
    // merged result, so the user saw "10:00 – 10:30" instead of the
    // override's narrower edited "10:05 – 10:20".
    const merged = mergeOverlappingActivities([garmin(), override()], categoryMap)
    expect(merged).toHaveLength(1)
    expect(merged[0].start_time).toEqual(new Date('2026-05-05T10:05:00Z'))
    expect(merged[0].end_time).toEqual(new Date('2026-05-05T10:20:00Z'))
  })

  test('override winner uses its own activity_type (not the source type)', () => {
    const merged = mergeOverlappingActivities([garmin(), override()], categoryMap)
    expect(merged[0].activity_type).toBe('pipe_ceremony')
  })

  test('override winner uses its own title — source title does not fill in', () => {
    // Even when the override clears the title (empty string), the source
    // title must NOT leak through; that would be the same "edits vanished"
    // bug as the time-span case.
    const merged = mergeOverlappingActivities(
      [garmin({ title: 'Meditation' }), override({ title: '' })],
      categoryMap,
    )
    expect(merged[0].title).toBe('')
  })

  test('override winner notes stand alone — source notes are not concatenated', () => {
    const merged = mergeOverlappingActivities(
      [garmin({ notes: 'auto-imported by Garmin' }), override({ notes: 'pipe ceremony with elders' })],
      categoryMap,
    )
    expect(merged[0].notes).toBe('pipe ceremony with elders')
    expect(merged[0].notes).not.toContain('auto-imported')
  })

  test('non-override merge still blends (cross-source pairing extends the span)', () => {
    // Sanity: the field-blending behaviour we suppressed for overrides is
    // intentional for the cross-source case (e.g. Garmin + Polar reporting
    // the same physical session — extend to the union of times).
    const polarLike = garmin({
      end_time: new Date('2026-05-05T10:35:00Z'),
      id: 'health-connect-id',
      source: 'health_connect',
      start_time: new Date('2026-05-05T09:55:00Z'),
    })
    const merged = mergeOverlappingActivities([garmin(), polarLike], categoryMap)
    expect(merged).toHaveLength(1)
    // Cross-source merge should still extend to the wider span.
    expect(merged[0].start_time).toEqual(new Date('2026-05-05T09:55:00Z'))
    expect(merged[0].end_time).toEqual(new Date('2026-05-05T10:35:00Z'))
  })

  test('override winner records source_ids for provenance', () => {
    const merged = mergeOverlappingActivities([garmin(), override()], categoryMap)
    expect(merged[0].source_ids).toContain('garmin-id')
    expect(merged[0].source_ids).toContain('aurboda-id')
  })
})
