import { describe, expect, it } from 'vitest'

import type { ChartItem } from './types'

import { tagSourceColors } from './colors'
import { CATEGORY_MATCHERS, LEGACY_CATEGORY_MAP } from './legendCategories'

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

describe('LEGACY_CATEGORY_MAP', () => {
  it('maps sleep, nap, rest to sleep_rest', () => {
    expect(LEGACY_CATEGORY_MAP.sleep).toBe('sleep_rest')
    expect(LEGACY_CATEGORY_MAP.nap).toBe('sleep_rest')
    expect(LEGACY_CATEGORY_MAP.rest).toBe('sleep_rest')
  })
})

describe('CATEGORY_MATCHERS', () => {
  it('activity matches Activity and Screen Time columns', () => {
    expect(CATEGORY_MATCHERS.activity(makeItem({ column: 'Activity' }))).toBe(true)
    expect(CATEGORY_MATCHERS.activity(makeItem({ column: 'Screen Time' }))).toBe(true)
    expect(CATEGORY_MATCHERS.activity(makeItem({ column: 'Location' }))).toBe(false)
  })

  it('location matches Location column', () => {
    expect(CATEGORY_MATCHERS.location(makeItem({ column: 'Location' }))).toBe(true)
    expect(CATEGORY_MATCHERS.location(makeItem({ column: 'Activity' }))).toBe(false)
  })

  it('music matches Music column', () => {
    expect(CATEGORY_MATCHERS.music(makeItem({ column: 'Music' }))).toBe(true)
  })

  it('exercise matches activity_type exercise', () => {
    expect(CATEGORY_MATCHERS.exercise(makeItem({ activity_type: 'exercise' }))).toBe(true)
    expect(CATEGORY_MATCHERS.exercise(makeItem({ activity_type: 'sleep' }))).toBe(false)
  })

  it('sleep_rest matches sleep, nap, rest activity types', () => {
    expect(CATEGORY_MATCHERS.sleep_rest(makeItem({ activity_type: 'sleep' }))).toBe(true)
    expect(CATEGORY_MATCHERS.sleep_rest(makeItem({ activity_type: 'nap' }))).toBe(true)
    expect(CATEGORY_MATCHERS.sleep_rest(makeItem({ activity_type: 'rest' }))).toBe(true)
    expect(CATEGORY_MATCHERS.sleep_rest(makeItem({ activity_type: 'exercise' }))).toBe(false)
  })

  it('meal matches entity_type meal', () => {
    expect(CATEGORY_MATCHERS.meal(makeItem({ entity_type: 'meal' }))).toBe(true)
    expect(CATEGORY_MATCHERS.meal(makeItem({ entity_type: 'activity' }))).toBe(false)
  })

  it('calendar matches Activity column with calendar color', () => {
    expect(CATEGORY_MATCHERS.calendar(makeItem({ color: tagSourceColors.calendar }))).toBe(true)
    expect(CATEGORY_MATCHERS.calendar(makeItem({ color: '#000' }))).toBe(false)
  })

  it('screentime matches Screen Time column', () => {
    expect(CATEGORY_MATCHERS.screentime(makeItem({ column: 'Screen Time' }))).toBe(true)
  })

  it('other matches Activity items without activity_type and not calendar', () => {
    expect(CATEGORY_MATCHERS.other(makeItem({ entity_type: 'activity' }))).toBe(true)
    // Calendar items are excluded
    expect(
      CATEGORY_MATCHERS.other(makeItem({ color: tagSourceColors.calendar, entity_type: 'activity' })),
    ).toBe(false)
    // Items with activity_type are excluded
    expect(CATEGORY_MATCHERS.other(makeItem({ activity_type: 'exercise', entity_type: 'activity' }))).toBe(
      false,
    )
  })

  it('metrics sub-toggles return false (handled at draw level)', () => {
    expect(CATEGORY_MATCHERS.hr(makeItem())).toBe(false)
    expect(CATEGORY_MATCHERS.hrv(makeItem())).toBe(false)
    expect(CATEGORY_MATCHERS.stress(makeItem())).toBe(false)
    expect(CATEGORY_MATCHERS.steps(makeItem())).toBe(false)
    expect(CATEGORY_MATCHERS.calories(makeItem())).toBe(false)
    expect(CATEGORY_MATCHERS.training_load(makeItem())).toBe(false)
    expect(CATEGORY_MATCHERS.screen_time_h(makeItem())).toBe(false)
  })
})
