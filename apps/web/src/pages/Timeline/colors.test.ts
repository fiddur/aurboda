import type { ScreentimeCategory } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import type { Activity, ProductivityRecord } from '../../state/api'

import {
  getActivityColor,
  getExerciseColor,
  getPlaceColor,
  getProductivityColor,
  getResolvedColor,
  resolveCategoryIcon,
  tagSourceColors,
} from './colors'

const makeActivity = (overrides: Partial<Activity> = {}): Activity =>
  ({
    activity_type: 'exercise',
    id: '1',
    start_time: new Date('2026-01-01T08:00:00Z'),
    ...overrides,
  }) as Activity

describe('getPlaceColor', () => {
  const names = ['Home', 'Office', 'Gym']

  it('returns gray for empty name', () => {
    expect(getPlaceColor('', names)).toBe('#9ca3af')
  })

  it('returns gray for Travel', () => {
    expect(getPlaceColor('Travel', names)).toBe('#9ca3af')
  })

  it('returns gray for Unknown', () => {
    expect(getPlaceColor('Unknown', names)).toBe('#9ca3af')
  })

  it('returns palette color based on index', () => {
    const color = getPlaceColor('Home', names)
    expect(color).toBeTypeOf('string')
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('wraps around palette for large indices', () => {
    const manyNames = Array.from({ length: 20 }, (_, i) => `Place${i}`)
    const color0 = getPlaceColor('Place0', manyNames)
    const color8 = getPlaceColor('Place8', manyNames)
    expect(color0).toBe(color8) // wraps at palette length (8)
  })
})

describe('getExerciseColor', () => {
  it('returns default green when no HR zones', () => {
    expect(getExerciseColor(makeActivity())).toBe('#22c55e')
  })

  it('returns color of dominant HR zone', () => {
    const activity = makeActivity({
      hr_zone_secs: { 0: 10, 1: 20, 2: 100, 3: 50, 4: 30, 5: 5 },
    })
    expect(getExerciseColor(activity)).toBe('#3b82f6') // zone 2
  })

  it('returns zone 5 color for high-intensity', () => {
    const activity = makeActivity({
      hr_zone_secs: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 10, 5: 100 },
    })
    expect(getExerciseColor(activity)).toBe('#ef4444') // zone 5
  })
})

describe('getActivityColor', () => {
  it('returns calendar color for calendar source', () => {
    expect(getActivityColor(makeActivity({ source: 'calendar' }))).toBe(tagSourceColors.calendar)
  })

  it('returns default color when no source', () => {
    expect(getActivityColor(makeActivity({ source: undefined }))).toBe(tagSourceColors.default)
  })

  it('returns default color for unknown source', () => {
    expect(getActivityColor(makeActivity({ source: 'unknown_source' }))).toBe(tagSourceColors.default)
  })
})

describe('getProductivityColor', () => {
  it('returns neutral gray for undefined score', () => {
    expect(getProductivityColor(undefined)).toBe('#9ca3af')
  })

  it('returns blue for score 1', () => {
    expect(getProductivityColor(1)).toBe('#3b82f6')
  })

  it('returns green for score 2', () => {
    expect(getProductivityColor(2)).toBe('#22c55e')
  })

  it('returns orange for score -1', () => {
    expect(getProductivityColor(-1)).toBe('#f97316')
  })
})

describe('getResolvedColor', () => {
  const categories: ScreentimeCategory[] = [
    { id: '1', name: ['Work'], color: '#0000ff' } as ScreentimeCategory,
    { id: '2', name: ['Work', 'Programming'], color: '#00ff00' } as ScreentimeCategory,
  ]

  const makeRecord = (overrides: Partial<ProductivityRecord> = {}): ProductivityRecord =>
    ({
      activity: 'vscode',
      end_time: new Date('2026-01-01T09:00:00Z'),
      productivity: 2,
      start_time: new Date('2026-01-01T08:00:00Z'),
      ...overrides,
    }) as ProductivityRecord

  it('returns category color for matching resolved_category', () => {
    expect(getResolvedColor(makeRecord({ resolved_category: ['Work', 'Programming'] }), categories)).toBe(
      '#00ff00',
    )
  })

  it('walks up to parent category when no exact match', () => {
    expect(getResolvedColor(makeRecord({ resolved_category: ['Work', 'Design'] }), categories)).toBe(
      '#0000ff',
    )
  })

  it('falls back to productivity color when no category match', () => {
    expect(getResolvedColor(makeRecord({ resolved_category: ['Gaming'] }), categories)).toBe('#22c55e')
  })

  it('falls back to productivity color when no resolved_category', () => {
    expect(getResolvedColor(makeRecord(), categories)).toBe('#22c55e')
  })
})

describe('resolveCategoryIcon', () => {
  const icons: Record<string, string> = {
    'category:Work': '💼',
    'category:Work > Programming': '💻',
  }

  it('returns undefined for empty category', () => {
    expect(resolveCategoryIcon(undefined, icons)).toBeUndefined()
    expect(resolveCategoryIcon([], icons)).toBeUndefined()
  })

  it('returns deepest matching icon', () => {
    expect(resolveCategoryIcon(['Work', 'Programming'], icons)).toBe('💻')
  })

  it('walks up to parent when no exact match', () => {
    expect(resolveCategoryIcon(['Work', 'Design'], icons)).toBe('💼')
  })

  it('returns undefined when no match at any depth', () => {
    expect(resolveCategoryIcon(['Gaming', 'FPS'], icons)).toBeUndefined()
  })
})
