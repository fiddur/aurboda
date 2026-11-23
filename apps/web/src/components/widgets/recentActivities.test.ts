import type { RecentActivity } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  emptyMessage,
  fallbackGlyph,
  recentActivitiesQuery,
  recentActivitiesTitle,
  rowFigures,
  rowLabel,
  rowWhen,
} from './recentActivities'

const row = (extra: Partial<RecentActivity> = {}): RecentActivity => ({
  activity_type: 'running',
  start_time: '2026-11-21T17:57:00.000Z',
  type_name: 'Running',
  ...extra,
})

describe('recentActivitiesTitle', () => {
  it('uses the configured title', () => {
    expect(recentActivitiesTitle({ title: 'Activities' }, false)).toBe('Activities')
  })

  it('falls back for an empty title', () => {
    expect(recentActivitiesTitle({ title: '' }, false)).toBe('Today')
  })

  it('is Today for a rolling today card, else Latest activities', () => {
    expect(recentActivitiesTitle({}, false)).toBe('Today')
    expect(recentActivitiesTitle({ window: 'today' }, true)).toBe('Latest activities')
    expect(recentActivitiesTitle({ window: 'latest' }, false)).toBe('Latest activities')
  })
})

describe('recentActivitiesQuery', () => {
  it('sends the defaults and the timezone', () => {
    expect(recentActivitiesQuery({}, 'Europe/Stockholm')).toEqual({
      limit: 5,
      tz: 'Europe/Stockholm',
      window: 'today',
    })
  })

  it('joins the type lists and sends the set fields', () => {
    expect(
      recentActivitiesQuery(
        {
          exclude_types: ['walking', 'cycling'],
          limit: 8,
          lookback_days: 14,
          manual_only: true,
          types: ['exercise'],
          window: 'latest',
        },
        'UTC',
      ),
    ).toEqual({
      exclude_types: 'walking,cycling',
      limit: 8,
      lookback_days: 14,
      manual_only: true,
      types: 'exercise',
      tz: 'UTC',
      window: 'latest',
    })
  })

  it('leaves out empty lists, a false manual_only and lookback_days without latest', () => {
    expect(
      recentActivitiesQuery({ exclude_types: [], lookback_days: 14, manual_only: false, types: [] }, 'UTC'),
    ).toEqual({ limit: 5, tz: 'UTC', window: 'today' })
  })
})

describe('rowLabel', () => {
  it('is the title, else the type name', () => {
    expect(rowLabel(row({ title: 'Evening run' }))).toBe('Evening run')
    expect(rowLabel(row())).toBe('Running')
  })
})

describe('rowWhen', () => {
  const now = new Date('2026-11-21T20:00:00.000Z')
  const tz = 'Europe/Stockholm'

  it('shows the time for today', () => {
    expect(rowWhen(row(), now, tz)).toBe('18:57')
  })

  it('shows Yesterday and the time for yesterday', () => {
    expect(rowWhen(row({ start_time: '2026-11-20T17:30:00.000Z' }), now, tz)).toBe('Yesterday 18:30')
  })

  it('shows the date and the time for older days', () => {
    expect(rowWhen(row({ start_time: '2026-11-16T17:30:00.000Z' }), now, tz)).toBe('16 Nov 18:30')
  })

  it('adds the year for another year', () => {
    expect(rowWhen(row({ start_time: '2025-11-16T17:30:00.000Z' }), now, tz)).toBe('16 Nov 2025 18:30')
  })

  it('compares calendar days in tz', () => {
    const lateNow = new Date('2026-11-21T23:30:00.000Z')
    expect(rowWhen(row({ start_time: '2026-11-21T22:30:00.000Z' }), lateNow, 'UTC')).toBe('22:30')
    expect(rowWhen(row({ start_time: '2026-11-21T22:30:00.000Z' }), lateNow, tz)).toBe('Yesterday 23:30')
  })
})

describe('rowFigures', () => {
  it('shows duration, distance and pace for a run', () => {
    expect(
      rowFigures(row({ distance_m: 5000, duration_minutes: 25, end_time: '2026-11-21T18:22:29.000Z' })),
    ).toBe('25m · 5.0 km · 5:06 /km')
  })

  it('leaves the pace out without an end', () => {
    expect(rowFigures(row({ distance_m: 5000 }))).toBe('5.0 km')
  })

  it('shows speed for a ride', () => {
    expect(
      rowFigures(
        row({
          activity_type: 'cycling',
          distance_m: 20000,
          duration_minutes: 60,
          end_time: '2026-11-21T18:57:00.000Z',
          type_name: 'Cycling',
        }),
      ),
    ).toBe('1h · 20.0 km · 20.0 km/h')
  })

  it('puts the type name first when the label is a different title', () => {
    expect(rowFigures(row({ duration_minutes: 30, title: 'Morning run' }))).toBe('Running · 30m')
    expect(rowFigures(row({ duration_minutes: 30, title: 'Running' }))).toBe('30m')
  })

  it('shows at most three figures', () => {
    expect(
      rowFigures(
        row({
          activity_type: 'strength_training',
          avg_hr: 112.4,
          calories: 177,
          duration_minutes: 50,
          set_count: 12,
          type_name: 'Strength',
        }),
      ),
    ).toBe('50m · 12 sets · 112 bpm')
  })

  it('counts one set and shows heart rate and calories', () => {
    expect(rowFigures(row({ avg_hr: 62, calories: 177, set_count: 1 }))).toBe('1 set · 62 bpm · 177 kcal')
  })

  it("appends the type's summary fields after the figures, with their units", () => {
    expect(
      rowFigures(
        row({
          duration_minutes: 5,
          summary_fields: [
            { label: 'Substance', value: 'Zinc' },
            { label: 'Dose', unit: 'mg', value: 10 },
          ],
        }),
      ),
    ).toBe('5m · Zinc · 10 mg')
  })

  it('is empty without figures or a title', () => {
    expect(rowFigures(row())).toBe('')
  })
})

describe('emptyMessage', () => {
  it('says what is empty', () => {
    expect(emptyMessage({}, false)).toBe('Nothing logged today')
    expect(emptyMessage({ window: 'latest' }, false)).toBe('No activities in the last 30 days')
    expect(emptyMessage({ lookback_days: 7, window: 'latest' }, false)).toBe(
      'No activities in the last 7 days',
    )
    expect(emptyMessage({ window: 'today' }, true)).toBe('No activities in this period')
  })
})

describe('fallbackGlyph', () => {
  it('suggests an emoji from the type name, else the type initial', () => {
    expect(fallbackGlyph(row({ title: 'Lunch loop' }))).toBe('🏃')
    expect(
      fallbackGlyph(
        row({ activity_type: 'strength_training', title: 'Push', type_name: 'Strength Training' }),
      ),
    ).toBe('S')
  })
})
