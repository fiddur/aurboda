import type { ScreentimeCategory } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import type { Activity, Meal, Place } from '../../state/api'

import {
  categorizeLocations,
  categorizeMeals,
  categorizeOtherActivities,
  categorizeScreentimeActivities,
} from './categorize'

describe('categorizeLocations', () => {
  const makePlace = (region: string, start: string, end: string): Place =>
    ({
      end_time: new Date(end),
      region,
      start_time: new Date(start),
    }) as Place

  it('returns ChartItems for locations', () => {
    const places = [makePlace('Home', '2026-01-01T08:00:00Z', '2026-01-01T12:00:00Z')]
    const items = categorizeLocations(places, ['Home'])
    expect(items).toHaveLength(1)
    expect(items[0]!.column).toBe('Location')
    expect(items[0]!.label).toBe('Home')
    expect(items[0]!.isPoint).toBe(false)
  })

  it('uses "Unknown" for empty region', () => {
    const places = [makePlace('', '2026-01-01T08:00:00Z', '2026-01-01T12:00:00Z')]
    const items = categorizeLocations(places, [])
    expect(items[0]!.label).toBe('Unknown')
  })

  it('generates href with date and name', () => {
    const places = [makePlace('Office', '2026-01-01T08:00:00Z', '2026-01-01T12:00:00Z')]
    const items = categorizeLocations(places, ['Office'])
    expect(items[0]!.href).toContain('/places?date=')
    expect(items[0]!.href).toContain('name=Office')
  })
})

describe('categorizeOtherActivities', () => {
  const makeActivity = (overrides: Partial<Activity> = {}): Activity =>
    ({
      activity_type: 'custom',
      id: '1',
      start_time: new Date('2026-01-01T08:00:00Z'),
      ...overrides,
    }) as Activity

  it('creates point items for activities without end_time', () => {
    const items = categorizeOtherActivities([makeActivity()], {})
    expect(items[0]!.isPoint).toBe(true)
  })

  it('creates duration items for activities with end_time', () => {
    const items = categorizeOtherActivities(
      [makeActivity({ end_time: new Date('2026-01-01T09:00:00Z') })],
      {},
    )
    expect(items[0]!.isPoint).toBe(false)
  })

  it('filters out lastfm source activities', () => {
    const items = categorizeOtherActivities([makeActivity({ source: 'lastfm' })], {})
    expect(items).toHaveLength(0)
  })

  it('resolves icon from itemIcons', () => {
    const items = categorizeOtherActivities([makeActivity({ title: 'Yoga' })], { Yoga: '🧘' })
    expect(items[0]!.icon).toBe('🧘')
  })

  it('resolves icon from type definition map', () => {
    const typeDefsMap = new Map([['custom', { icon: '🎯' }]])
    const items = categorizeOtherActivities([makeActivity()], {}, typeDefsMap)
    expect(items[0]!.icon).toBe('🎯')
  })

  it('prefers type definition icon over title-based itemIcons match', () => {
    // Activity originally synced as "meditation" then re-typed to "Pipeceremony".
    // The user's tag-based itemIcons still has "meditation" → 🧘, but the type
    // definition for "Pipeceremony" has its own icon — the type icon must win.
    const typeDefsMap = new Map([['Pipeceremony', { icon: '🪶' }]])
    const items = categorizeOtherActivities(
      [makeActivity({ activity_type: 'Pipeceremony', title: 'meditation' })],
      { meditation: '🧘' },
      typeDefsMap,
    )
    expect(items[0]!.icon).toBe('🪶')
  })

  it('falls back to title-based icon when type definition has no icon', () => {
    const typeDefsMap = new Map([['custom', {}]])
    const items = categorizeOtherActivities([makeActivity({ title: 'Yoga' })], { Yoga: '🧘' }, typeDefsMap)
    expect(items[0]!.icon).toBe('🧘')
  })
})

describe('categorizeMeals', () => {
  const makeMeal = (overrides: Partial<Meal> = {}): Meal =>
    ({
      id: '1',
      meal_type: 'breakfast',
      time: new Date('2026-01-01T08:00:00Z'),
      ...overrides,
    }) as Meal

  it('creates point items for meals', () => {
    const items = categorizeMeals([makeMeal()], {})
    expect(items[0]!.isPoint).toBe(true)
    expect(items[0]!.entity_type).toBe('meal')
  })

  it('uses default icon when no custom icon', () => {
    const items = categorizeMeals([makeMeal()], {})
    expect(items[0]!.icon).toBeDefined()
  })

  it('capitalizes meal type for label', () => {
    const items = categorizeMeals([makeMeal({ meal_type: 'lunch' })], {})
    expect(items[0]!.label).toBe('Lunch')
  })

  it('uses meal name when available', () => {
    const items = categorizeMeals([makeMeal({ name: 'Oatmeal' })], {})
    expect(items[0]!.label).toBe('Oatmeal')
  })

  it('creates separate items for food items with icons', () => {
    const meal = makeMeal({
      food_items: [
        { icon: '🥚', name: 'Egg' } as Meal['food_items'] extends (infer T)[] | undefined ? T : never,
        { icon: '🥓', name: 'Bacon' } as Meal['food_items'] extends (infer T)[] | undefined ? T : never,
      ],
    })
    const items = categorizeMeals([meal], {})
    expect(items).toHaveLength(2)
    expect(items[0]!.icon).toBe('🥚')
    expect(items[1]!.icon).toBe('🥓')
  })
})

describe('categorizeScreentimeActivities', () => {
  const makeActivity = (overrides: Partial<Activity> = {}): Activity =>
    ({
      activity_type: 'screentime',
      data: { category_path: 'Work > Programming' },
      end_time: new Date('2026-01-01T09:00:00Z'),
      id: 'act-1',
      source: 'rescuetime',
      start_time: new Date('2026-01-01T08:00:00Z'),
      ...overrides,
    }) as Activity

  const makeCategory = (overrides: Partial<ScreentimeCategory>): ScreentimeCategory =>
    ({
      id: 'cat-1',
      name: ['Work', 'Programming'],
      ...overrides,
    }) as ScreentimeCategory

  it('returns Screen Time column items routed to the activity entity', () => {
    const items = categorizeScreentimeActivities([makeActivity()], [], {})
    expect(items).toHaveLength(1)
    expect(items[0]!.column).toBe('Screen Time')
    expect(items[0]!.entity_type).toBe('activity')
  })

  it('uses last category-path segment as label', () => {
    const items = categorizeScreentimeActivities([makeActivity()], [], {})
    expect(items[0]!.label).toBe('Programming')
  })

  it('skips activities without an end_time', () => {
    const items = categorizeScreentimeActivities([makeActivity({ end_time: undefined })], [], {})
    expect(items).toEqual([])
  })

  it('skips activities of other types', () => {
    const items = categorizeScreentimeActivities([makeActivity({ activity_type: 'exercise' })], [], {})
    expect(items).toEqual([])
  })

  it('matches category by exact path for href and clears entity_id', () => {
    const items = categorizeScreentimeActivities([makeActivity()], [makeCategory({ id: 'cat-prog' })], {})
    expect(items[0]!.href).toBe('/screentime-categories/cat-prog')
    expect(items[0]!.entity_id).toBeUndefined()
  })

  it('walks up the path to find a parent-category match', () => {
    const items = categorizeScreentimeActivities(
      [makeActivity()],
      [makeCategory({ id: 'cat-work', name: ['Work'], color: '#abc' })],
      {},
    )
    expect(items[0]!.color).toBe('#abc')
    expect(items[0]!.href).toBe('/screentime-categories/cat-work')
  })

  it('keeps the activity id as entity_id when no category matches', () => {
    const items = categorizeScreentimeActivities([makeActivity()], [], {})
    expect(items[0]!.entity_id).toBe('act-1')
    expect(items[0]!.href).toBeUndefined()
  })

  it('uses category icon from itemIcons', () => {
    const items = categorizeScreentimeActivities([makeActivity()], [], {
      'category:Work > Programming': '💻',
    })
    expect(items[0]!.icon).toBe('💻')
  })

  it('handles missing category_path gracefully', () => {
    const items = categorizeScreentimeActivities([makeActivity({ data: {} })], [], {})
    expect(items[0]!.label).toBe('Screen time')
  })
})
