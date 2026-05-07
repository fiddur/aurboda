import { describe, expect, it } from 'vitest'

import type { ActivityTypeDefinition } from '../../state/api'
import type { ChartItem } from './types'

import { tagSourceColors } from './colors'
import {
  buildCategoryMatchers,
  buildScreentimeSubEntries,
  isScreentimeSubKey,
  LEGACY_CATEGORY_MAP,
  screentimeSubKey,
} from './legendCategories'

const makeItem = (overrides: Partial<ChartItem> = {}): ChartItem => ({
  color: '#333',
  column: 'Activity',
  end: new Date('2026-01-01T09:00:00Z'),
  isPoint: false,
  label: 'Test',
  start: new Date('2026-01-01T08:00:00Z'),
  tooltip: { details: [], time: '', title: '' },
  ...overrides,
})

const def = (overrides: Partial<ActivityTypeDefinition>): ActivityTypeDefinition =>
  ({
    aliases: [],
    color: '#888',
    display_category: 'productivity',
    display_name: 'Test',
    is_builtin: false,
    name: 'test',
    show_on_timeline: true,
    ...overrides,
  }) as ActivityTypeDefinition

const matchers = (typeDefs: ActivityTypeDefinition[], screentimeDerivedTypes: ReadonlySet<string>) => {
  const subEntries = buildScreentimeSubEntries(typeDefs, screentimeDerivedTypes)
  const typeDefsMap = new Map(typeDefs.map((d) => [d.name, { parent_type: d.parent_type }]))
  return buildCategoryMatchers(typeDefsMap, subEntries)
}

describe('LEGACY_CATEGORY_MAP', () => {
  it('maps sleep, nap, rest to sleep_rest (URL-hash backwards compat)', () => {
    expect(LEGACY_CATEGORY_MAP.sleep).toBe('sleep_rest')
    expect(LEGACY_CATEGORY_MAP.nap).toBe('sleep_rest')
    expect(LEGACY_CATEGORY_MAP.rest).toBe('sleep_rest')
  })
})

describe('static CATEGORY_MATCHERS (built without screentime sub-entries)', () => {
  const m = matchers([], new Set())

  it('activity matches Activity and Screen Time columns', () => {
    expect(m.activity(makeItem({ column: 'Activity' }))).toBe(true)
    expect(m.activity(makeItem({ column: 'Screen Time' }))).toBe(true)
    expect(m.activity(makeItem({ column: 'Location' }))).toBe(false)
  })

  it('location matches Location column', () => {
    expect(m.location(makeItem({ column: 'Location' }))).toBe(true)
    expect(m.location(makeItem({ column: 'Activity' }))).toBe(false)
  })

  it('music matches Music column', () => {
    expect(m.music(makeItem({ column: 'Music' }))).toBe(true)
  })

  it('exercise matches activity_type exercise', () => {
    expect(m.exercise(makeItem({ activity_type: 'exercise' }))).toBe(true)
    expect(m.exercise(makeItem({ activity_type: 'sleep' }))).toBe(false)
  })

  it('sleep_rest matches sleep, nap, rest activity types', () => {
    expect(m.sleep_rest(makeItem({ activity_type: 'sleep' }))).toBe(true)
    expect(m.sleep_rest(makeItem({ activity_type: 'nap' }))).toBe(true)
    expect(m.sleep_rest(makeItem({ activity_type: 'rest' }))).toBe(true)
    expect(m.sleep_rest(makeItem({ activity_type: 'exercise' }))).toBe(false)
  })

  it('meal matches entity_type meal', () => {
    expect(m.meal(makeItem({ entity_type: 'meal' }))).toBe(true)
    expect(m.meal(makeItem({ entity_type: 'activity' }))).toBe(false)
  })

  it('calendar matches Activity column with calendar color', () => {
    expect(m.calendar(makeItem({ color: tagSourceColors.calendar }))).toBe(true)
    expect(m.calendar(makeItem({ color: '#000' }))).toBe(false)
  })

  it('screentime matches Screen Time column (legacy + derived after routing fix)', () => {
    expect(m.screentime(makeItem({ column: 'Screen Time' }))).toBe(true)
    expect(m.screentime(makeItem({ column: 'Activity' }))).toBe(false)
  })

  it('other matches Activity items without activity_type and not calendar', () => {
    expect(m.other(makeItem({ entity_type: 'activity' }))).toBe(true)
    expect(m.other(makeItem({ color: tagSourceColors.calendar, entity_type: 'activity' }))).toBe(false)
    expect(m.other(makeItem({ activity_type: 'exercise', entity_type: 'activity' }))).toBe(false)
  })

  it('metrics sub-toggles return false (handled at draw level)', () => {
    expect(m.hr(makeItem())).toBe(false)
    expect(m.hrv(makeItem())).toBe(false)
    expect(m.stress(makeItem())).toBe(false)
    expect(m.steps(makeItem())).toBe(false)
    expect(m.calories(makeItem())).toBe(false)
    expect(m.training_load(makeItem())).toBe(false)
    expect(m.screen_time_h(makeItem())).toBe(false)
  })
})

describe('buildScreentimeSubEntries', () => {
  it('returns one entry per top-level screentime-derived type, sorted by label', () => {
    const typeDefs = [
      def({ name: 'work', display_name: 'Work' }),
      def({ name: 'media', display_name: 'Media' }),
      // Children — should be excluded.
      def({ name: 'programming', display_name: 'Programming', parent_type: 'work' }),
      // Not in screentimeDerivedTypes — excluded.
      def({ name: 'exercise', display_name: 'Exercise' }),
    ]
    const entries = buildScreentimeSubEntries(typeDefs, new Set(['work', 'media', 'programming']))
    expect(entries.map((e) => e.type)).toEqual(['media', 'work'])
    expect(entries[0]!.legendKey).toBe('screentime:media')
    expect(entries[1]!.legendKey).toBe('screentime:work')
  })

  it('excludes types with show_on_timeline=false', () => {
    const typeDefs = [def({ name: 'hidden', display_name: 'Hidden', show_on_timeline: false })]
    expect(buildScreentimeSubEntries(typeDefs, new Set(['hidden']))).toEqual([])
  })

  it('returns empty when no screentime-derived types are present', () => {
    expect(buildScreentimeSubEntries([], new Set())).toEqual([])
  })
})

describe('dynamic screentime sub-toggle matchers (#718)', () => {
  it('matches an item by walking parent_type to the top-level slug', () => {
    const typeDefs = [
      def({ name: 'work', display_name: 'Work' }),
      def({ name: 'programming', display_name: 'Programming', parent_type: 'work' }),
    ]
    const m = matchers(typeDefs, new Set(['work', 'programming']))
    // A `programming` item in the Screen Time column should match the
    // `screentime:work` toggle (its root-walked ancestor is `work`).
    expect(m['screentime:work'](makeItem({ activity_type: 'programming', column: 'Screen Time' }))).toBe(true)
    // The same item should NOT match a different top-level toggle.
    expect(
      m['screentime:media']?.(makeItem({ activity_type: 'programming', column: 'Screen Time' })),
    ).toBeUndefined() // matcher doesn't exist for `media` since the type def isn't there
  })

  it('does not match items outside the Screen Time column', () => {
    const typeDefs = [def({ name: 'work', display_name: 'Work' })]
    const m = matchers(typeDefs, new Set(['work']))
    expect(m['screentime:work'](makeItem({ activity_type: 'work', column: 'Activity' }))).toBe(false)
  })
})

describe('isScreentimeSubKey / screentimeSubKey', () => {
  it('round-trips a top-level slug', () => {
    expect(screentimeSubKey('work')).toBe('screentime:work')
    expect(isScreentimeSubKey('screentime:work')).toBe(true)
    expect(isScreentimeSubKey('screentime')).toBe(false)
    expect(isScreentimeSubKey('exercise')).toBe(false)
  })
})
