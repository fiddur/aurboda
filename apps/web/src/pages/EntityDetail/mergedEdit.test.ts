import { describe, expect, it } from 'vitest'

import type { SourceRecord } from '../../state/api'

import { forceMergedSpanForOverride, mergedEditAction } from './mergedEdit'

const rec = (overrides: Partial<SourceRecord>): SourceRecord =>
  ({
    end_time: '2026-05-08T10:30:00Z',
    id: 'src-id',
    source: 'garmin',
    start_time: '2026-05-08T10:00:00Z',
    title: 'Activity',
    ...overrides,
  }) as SourceRecord

describe('mergedEditAction', () => {
  it('returns navigate to the aurboda source when one exists', () => {
    const sources = [
      rec({ id: 'garmin-1', source: 'garmin' }),
      rec({ id: 'aurboda-1', source: 'aurboda' }),
      rec({ id: 'strava-1', source: 'strava' }),
    ]
    expect(mergedEditAction(sources)).toEqual({
      kind: 'navigate',
      url: '/detail/activity/aurboda-1',
    })
  })

  it('returns null when no source is aurboda — caller falls through to in-place edit', () => {
    const sources = [rec({ id: 'garmin-1', source: 'garmin' }), rec({ id: 'strava-1', source: 'strava' })]
    expect(mergedEditAction(sources)).toBeNull()
  })

  it('returns null for missing or empty source_records (parent decides)', () => {
    expect(mergedEditAction(undefined)).toBeNull()
    expect(mergedEditAction([])).toBeNull()
  })

  it('picks the first aurboda when multiple exist (edge case)', () => {
    const sources = [rec({ id: 'aurboda-a', source: 'aurboda' }), rec({ id: 'aurboda-b', source: 'aurboda' })]
    const action = mergedEditAction(sources)
    expect(action?.url).toBe('/detail/activity/aurboda-a')
  })
})

describe('forceMergedSpanForOverride', () => {
  const t = (iso: string) => new Date(iso)

  it('returns merged span when on a merged view with no aurboda source', () => {
    const out = forceMergedSpanForOverride(true, false, t('2026-05-08T10:00:00Z'), t('2026-05-08T11:00:00Z'))
    expect(out).toEqual({
      end_time: '2026-05-08T11:00:00.000Z',
      start_time: '2026-05-08T10:00:00.000Z',
    })
  })

  it('returns null when not a merged view (in-place edit on a single activity)', () => {
    expect(
      forceMergedSpanForOverride(false, false, t('2026-05-08T10:00:00Z'), t('2026-05-08T11:00:00Z')),
    ).toBeNull()
  })

  it('returns null when aurboda source already exists (parent navigated away)', () => {
    expect(
      forceMergedSpanForOverride(true, true, t('2026-05-08T10:00:00Z'), t('2026-05-08T11:00:00Z')),
    ).toBeNull()
  })

  it('omits end_time when not provided (e.g. point activity)', () => {
    const out = forceMergedSpanForOverride(true, false, t('2026-05-08T10:00:00Z'), undefined)
    expect(out).toEqual({ start_time: '2026-05-08T10:00:00.000Z' })
  })

  it('returns null when neither start nor end is available', () => {
    expect(forceMergedSpanForOverride(true, false, undefined, undefined)).toBeNull()
  })
})
