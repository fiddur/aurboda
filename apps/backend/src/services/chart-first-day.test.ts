import { describe, expect, test, vi } from 'vitest'

import {
  allTimeLookbackDays,
  type ChartFirstDayDeps,
  getChartFirstDay,
  resolveChartLookbackDays,
} from './chart-first-day.ts'

const fakeDeps = (): ChartFirstDayDeps => ({
  expandActivityTypes: vi.fn(async (_user: string, types: string[]) => [...types, `${types[0]}_sub`]),
  getFirstActivityDay: vi.fn(async () => '2001-01-01'),
  getFirstActivityDayMatching: vi.fn(async () => '2002-02-02'),
  getFirstCategoryDay: vi.fn(async () => '2003-03-03'),
  getFirstJournalDay: vi.fn(async () => '1995-04-02'),
  getFirstMetricDay: vi.fn(async () => '2004-04-04'),
})

describe('getChartFirstDay', () => {
  test('an activity type reads its subtypes too', async () => {
    const deps = fakeDeps()
    expect(
      await getChartFirstDay('u', { pattern: 'running', source_type: 'activity_type', tz: 'UTC' }, {}, deps),
    ).toBe('2001-01-01')
    expect(deps.getFirstActivityDay).toHaveBeenCalledWith('u', ['running', 'running_sub'], 'UTC')
  })

  test('a tag source reads by type id, else by its regex', async () => {
    const deps = fakeDeps()
    await getChartFirstDay('u', { activity_type_id: 'id-1', source_type: 'tag', tz: 'UTC' }, {}, deps)
    expect(deps.getFirstActivityDay).toHaveBeenCalledWith('u', ['id-1', 'id-1_sub'], 'UTC')
    expect(await getChartFirstDay('u', { pattern: '^cof', source_type: 'tag', tz: 'UTC' }, {}, deps)).toBe(
      '2002-02-02',
    )
    expect(deps.getFirstActivityDayMatching).toHaveBeenCalledWith('u', '^cof', 'UTC')
  })

  test('a metric reads its trusted sources, and a heart-rate zone reads heart rate', async () => {
    const deps = fakeDeps()
    await getChartFirstDay('u', { pattern: 'steps', source_type: 'metric', tz: 'UTC' }, {}, deps)
    expect(vi.mocked(deps.getFirstMetricDay).mock.calls[0]?.[1]).toBe('steps')
    expect(vi.mocked(deps.getFirstMetricDay).mock.calls[0]?.[2]).not.toBeNull()
    await getChartFirstDay('u', { pattern: 'zone2_weekly', source_type: 'metric', tz: 'UTC' }, {}, deps)
    expect(vi.mocked(deps.getFirstMetricDay).mock.calls[1]).toEqual(['u', 'heart_rate', null, 'UTC'])
  })

  test('a category reads its sub-categories through the category query', async () => {
    const deps = fakeDeps()
    expect(
      await getChartFirstDay(
        'u',
        { pattern: 'Work', source_type: 'productivity_category', tz: 'UTC' },
        {},
        deps,
      ),
    ).toBe('2003-03-03')
  })

  test('the journal reads through its filters', async () => {
    const deps = fakeDeps()
    expect(
      await getChartFirstDay(
        'u',
        { journal_tags: 'travel', source_type: 'journal', tz: 'Europe/Stockholm' },
        {},
        deps,
      ),
    ).toBe('1995-04-02')
    expect(deps.getFirstJournalDay).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({ tags: ['travel'], tz: 'Europe/Stockholm' }),
    )
  })

  test('as a trend reads it, an activity type or tag source reads exactly that type', async () => {
    const deps = fakeDeps()
    const exact = { exactType: true }
    await getChartFirstDay('u', { pattern: 'running', source_type: 'activity_type', tz: 'UTC' }, exact, deps)
    expect(deps.getFirstActivityDay).toHaveBeenLastCalledWith('u', ['running'], 'UTC')
    await getChartFirstDay(
      'u',
      { activity_type_id: 'id-1', pattern: 'coffee', source_type: 'tag', tz: 'UTC' },
      exact,
      deps,
    )
    expect(deps.getFirstActivityDay).toHaveBeenLastCalledWith('u', ['coffee'], 'UTC')
    expect(deps.expandActivityTypes).not.toHaveBeenCalled()
    expect(deps.getFirstActivityDayMatching).not.toHaveBeenCalled()
    expect(await getChartFirstDay('u', { source_type: 'tag', tz: 'UTC' }, exact, deps)).toBeUndefined()
  })

  test('exactType leaves the other sources as they are', async () => {
    const deps = fakeDeps()
    const exact = { exactType: true }
    expect(
      await getChartFirstDay('u', { pattern: 'steps', source_type: 'metric', tz: 'UTC' }, exact, deps),
    ).toBe('2004-04-04')
    expect(
      await getChartFirstDay(
        'u',
        { pattern: 'Work', source_type: 'productivity_category', tz: 'UTC' },
        exact,
        deps,
      ),
    ).toBe('2003-03-03')
  })

  test('a source without a pattern has no first day', async () => {
    const deps = fakeDeps()
    expect(await getChartFirstDay('u', { source_type: 'metric', tz: 'UTC' }, {}, deps)).toBeUndefined()
    expect(await getChartFirstDay('u', { source_type: 'activity_type', tz: 'UTC' }, {}, deps)).toBeUndefined()
    expect(deps.getFirstMetricDay).not.toHaveBeenCalled()
  })
})

describe('allTimeLookbackDays', () => {
  test('whole days from the first day to today, at least one', () => {
    expect(allTimeLookbackDays('2026-11-01', '2026-11-28')).toBe(27)
    expect(allTimeLookbackDays('2026-11-28', '2026-11-28')).toBe(1)
    expect(allTimeLookbackDays('1995-04-02', '2026-11-28')).toBe(11563)
  })

  test('ten years without a first day', () => {
    expect(allTimeLookbackDays(undefined, '2026-11-28')).toBe(3650)
  })
})

describe('resolveChartLookbackDays', () => {
  test('keeps a fixed lookback without reading the first day', async () => {
    const deps = fakeDeps()
    expect(
      await resolveChartLookbackDays('u', { source_type: 'journal', tz: 'UTC' }, 90, new Date(), {}, deps),
    ).toBe(90)
    expect(deps.getFirstJournalDay).not.toHaveBeenCalled()
  })

  test('all time runs from the first day to the day of end', async () => {
    const end = new Date('2026-11-28T12:00:00Z')
    expect(
      await resolveChartLookbackDays('u', { source_type: 'journal', tz: 'UTC' }, 0, end, {}, fakeDeps()),
    ).toBe(11563)
  })

  test('passes exactType on to the first day', async () => {
    const deps = fakeDeps()
    const end = new Date('2026-11-28T12:00:00Z')
    expect(
      await resolveChartLookbackDays(
        'u',
        { pattern: 'running', source_type: 'activity_type', tz: 'UTC' },
        0,
        end,
        { exactType: true },
        deps,
      ),
    ).toBe(9462)
    expect(deps.getFirstActivityDay).toHaveBeenCalledWith('u', ['running'], 'UTC')
  })
})
