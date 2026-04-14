import { describe, expect, it } from 'vitest'

import type { Activity, Meal, Place, ProductivityRecord } from '../../state/api'

import {
  categorizeLocations,
  categorizeMeals,
  categorizeOtherActivities,
  categorizeProductivity,
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

describe('categorizeProductivity', () => {
  const makeRecord = (overrides: Partial<ProductivityRecord> = {}): ProductivityRecord =>
    ({
      activity: 'vscode',
      end_time: new Date('2026-01-01T09:00:00Z'),
      productivity: 2,
      resolved_category: ['Work', 'Programming'],
      start_time: new Date('2026-01-01T08:00:00Z'),
      ...overrides,
    }) as ProductivityRecord

  it('creates Screen Time column items', () => {
    const items = categorizeProductivity([makeRecord()], [], {})
    expect(items[0]!.column).toBe('Screen Time')
    expect(items[0]!.entity_type).toBe('productivity')
  })

  it('uses last category segment as label', () => {
    const items = categorizeProductivity([makeRecord()], [], {})
    expect(items[0]!.label).toBe('Programming')
  })

  it('falls back to activity name when no resolved_category', () => {
    const items = categorizeProductivity([makeRecord({ resolved_category: undefined })], [], {})
    expect(items[0]!.label).toBe('vscode')
  })

  it('resolves category icon from itemIcons', () => {
    const items = categorizeProductivity([makeRecord()], [], {
      'category:Work > Programming': '💻',
    })
    expect(items[0]!.icon).toBe('💻')
  })

  it('generates href for records with category_id', () => {
    const items = categorizeProductivity([makeRecord({ category_id: 'cat-1' })], [], {})
    expect(items[0]!.href).toBe('/screentime-categories/cat-1')
  })
})
