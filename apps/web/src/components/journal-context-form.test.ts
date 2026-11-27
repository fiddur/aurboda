import type { JournalContextItem } from '@aurboda/api-spec'

import { journalContextItemSchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  addItem,
  autosaveStep,
  type ContextKind,
  type IconSources,
  itemProblem,
  itemsToSaveOnClose,
  metricCarriesForward,
  metricHasSource,
  moveItem,
  nextItemId,
  removeItem,
  suggestedLabel,
  withDaysSinceSource,
  withKind,
  withMetric,
  withSuggestedLabel,
} from './journal-context-form'

const moon = (id: string): JournalContextItem => ({
  decimals: 0,
  id,
  kind: 'moon',
  label: '',
  value: 'illumination',
})

describe('journal context form', () => {
  test('new items get the first free id', () => {
    expect(nextItemId([])).toBe('c1')
    expect(nextItemId([moon('c1'), moon('c3')])).toBe('c2')
    expect(addItem([moon('c1')], 'metric')).toEqual([
      moon('c1'),
      { decimals: 0, id: 'c2', kind: 'metric', label: '', metric: '', missing: 'hide' },
    ])
  })

  test('changing the kind keeps the id, label and decimals', () => {
    expect(withKind({ decimals: 2, id: 'a', label: 'E' }, 'days_since')).toEqual({
      decimals: 2,
      id: 'a',
      kind: 'days_since',
      label: 'E',
      source_type: 'activity_type',
      unit: 'days',
    })
  })

  test('switching what time is counted from drops the field that no longer applies', () => {
    const since = withKind({ decimals: 0, id: 'a', label: 'A' }, 'days_since')
    if (since.kind !== 'days_since') throw new Error('not days_since')
    const fromActivity = { ...since, pattern: 'run' }
    const fromDate = withDaysSinceSource(fromActivity, 'date')
    expect(fromDate).not.toHaveProperty('pattern')
    expect(fromDate.source_type).toBe('date')
    const dated = { ...fromDate, date: '1980-05-17' }
    expect(withDaysSinceSource(dated, 'tag')).not.toHaveProperty('date')
  })

  const completions: Record<ContextKind, (item: JournalContextItem) => JournalContextItem> = {
    days_since: (item) => ({ ...item, pattern: 'run' }) as JournalContextItem,
    metric: (item) => ({ ...item, metric: 'weight' }) as JournalContextItem,
    moon: (item) => item,
    training_load: (item) => ({ ...item, value: 'tsb' }) as JournalContextItem,
    trend: (item) => ({ ...item, pattern: 'run' }) as JournalContextItem,
  }

  test.each(Object.keys(completions) as ContextKind[])(
    'a completed %s item from withKind is one the server accepts',
    (kind) => {
      const completed = completions[kind](withKind({ decimals: 1, id: 'a', label: 'A' }, kind))
      expect(itemProblem(completed)).toBeUndefined()
      expect(journalContextItemSchema.safeParse(completed).success).toBe(true)
    },
  )

  test('a completed fixed-date item is one the server accepts', () => {
    const since = withKind({ decimals: 1, id: 'a', label: 'A' }, 'days_since')
    if (since.kind !== 'days_since') throw new Error('not days_since')
    const fromDate = {
      ...withDaysSinceSource({ ...since, pattern: 'run' }, 'date'),
      date: '1980-05-17',
      unit: 'years' as const,
    }
    expect(itemProblem(fromDate)).toBeUndefined()
    expect(journalContextItemSchema.safeParse(fromDate).success).toBe(true)
    expect(journalContextItemSchema.safeParse(withDaysSinceSource(fromDate, 'tag')).success).toBe(false)
  })

  test('moves and removes items', () => {
    const items = [moon('a'), moon('b'), moon('c')]
    expect(moveItem(items, 0, 1).map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(moveItem(items, 0, -1).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(moveItem(items, 2, 1).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(removeItem(items, 1).map((i) => i.id)).toEqual(['a', 'c'])
  })

  test('names what an item still lacks', () => {
    expect(itemProblem(moon('a'))).toBeUndefined()
    expect(itemProblem(withKind({ decimals: 0, id: 'a', label: '' }, 'metric'))).toBe('Choose a metric')
    const date: JournalContextItem = {
      decimals: 1,
      id: 'a',
      kind: 'days_since',
      label: 'A',
      source_type: 'date',
      unit: 'years',
    }
    expect(itemProblem(date)).toBe('Choose a date')
    expect(itemProblem({ ...date, date: '1980-05-17' })).toBeUndefined()
  })

  describe('autosaveStep', () => {
    const saved = [moon('a')]
    const incomplete = withKind({ decimals: 0, id: 'b', label: '' }, 'metric')

    test('does nothing when the items are what the server has', () => {
      expect(autosaveStep([moon('a')], JSON.stringify(saved), false)).toEqual({ action: 'none' })
    })

    test('saves changed, complete items', () => {
      const items = [moon('a'), moon('b')]
      expect(autosaveStep(items, JSON.stringify(saved), false)).toEqual({ action: 'save', items })
    })

    test('holds on an incomplete item and names it', () => {
      expect(autosaveStep([moon('a'), incomplete], JSON.stringify(saved), false)).toEqual({
        action: 'blocked',
        problem: 'Choose a metric',
      })
    })

    test('on close saves the complete items and drops the incomplete ones', () => {
      expect(itemsToSaveOnClose([moon('a'), incomplete, moon('c')]).map((i) => i.id)).toEqual(['a', 'c'])
    })

    test('waits for the save in flight, so the follow-up sends the latest items', () => {
      const items = [moon('b')]
      expect(autosaveStep(items, JSON.stringify(saved), true)).toEqual({ action: 'wait' })
      expect(autosaveStep(items, JSON.stringify(saved), false)).toEqual({ action: 'save', items })
    })
  })

  describe('label suggestion', () => {
    const icons: IconSources = {
      itemIcons: { meditation: '🧘‍♂️', sauna: '/api/icons/abc' },
      typeIcons: new Map([
        ['running', '🏃'],
        ['sauna', '🔥'],
      ]),
    }
    const since = (pattern: string, label = ''): JournalContextItem => ({
      decimals: 0,
      id: 'a',
      kind: 'days_since',
      label,
      pattern,
      source_type: 'activity_type',
      unit: 'days',
    })

    test("suggests the user's icon, else the type's, else the built-in emoji", () => {
      expect(suggestedLabel(since('meditation'), icons)).toBe('🧘‍♂️')
      expect(suggestedLabel(since('running'), icons)).toBe('🏃')
      expect(suggestedLabel(since('sauna'), icons)).toBe('🔥')
      expect(suggestedLabel(since('coffee'), icons)).toBe('☕')
      expect(suggestedLabel(since('zzz_unknown'), icons)).toBeUndefined()
      expect(
        suggestedLabel({ ...withKind(moon('m'), 'metric'), metric: 'weight' } as JournalContextItem, icons),
      ).toBe('⚖️')
      expect(suggestedLabel(moon('m'), icons)).toBeUndefined()
    })

    test('fills an empty label', () => {
      expect(withSuggestedLabel(since(''), since('running'), icons).label).toBe('🏃')
    })

    test('keeps a label the user typed', () => {
      expect(withSuggestedLabel(since('', 'R'), since('running', 'R'), icons).label).toBe('R')
      expect(withSuggestedLabel(since('running', '🏃'), since('running', 'Run'), icons).label).toBe('Run')
    })

    test('re-suggests only when the data changed', () => {
      const blank = since('running', '')
      expect(withSuggestedLabel(blank, { ...blank, decimals: 1 }, icons).label).toBe('')
      expect(withSuggestedLabel(blank, { ...blank, unit: 'weeks' } as JournalContextItem, icons).label).toBe(
        '',
      )
      expect(withSuggestedLabel(blank, since('coffee', ''), icons).label).toBe('☕')
    })

    test('replaces the earlier suggestion with the new one, or clears it when there is none', () => {
      expect(withSuggestedLabel(since('running', '🏃'), since('coffee', '🏃'), icons).label).toBe('☕')
      expect(withSuggestedLabel(since('running', '🏃'), since('zzz_unknown', '🏃'), icons).label).toBe('')
    })
  })

  describe('metric options', () => {
    const metric = (raw: Partial<JournalContextItem>) =>
      ({ ...withKind(moon('a'), 'metric'), ...raw }) as Extract<JournalContextItem, { kind: 'metric' }>

    test('offers a source and a carry-forward only where the server reads them', () => {
      expect(metricHasSource('weight')).toBe(true)
      expect(metricHasSource('rhr_7day')).toBe(true)
      expect(metricHasSource('zone2_weekly')).toBe(false)
      expect(metricHasSource('hrv_sleep')).toBe(false)
      expect(metricHasSource('hr_zone_2_sec')).toBe(false)
      expect(metricCarriesForward('weight')).toBe(true)
      expect(metricCarriesForward('rhr_30day')).toBe(false)
      expect(metricCarriesForward('zone2_weekly')).toBe(false)
      expect(metricCarriesForward('hrv_sleep')).toBe(false)
    })

    test('picking a metric drops the options it ignores', () => {
      const weight = metric({ metric: 'weight', missing: 'carry_forward', source: 'garmin' })
      expect(withMetric(weight, 'steps')).toMatchObject({ missing: 'carry_forward', source: 'garmin' })
      const zone = withMetric(weight, 'zone2_weekly')
      expect(zone).not.toHaveProperty('source')
      expect(zone.missing).toBe('hide')
      expect(withMetric(weight, 'rhr_7day')).toMatchObject({ missing: 'hide', source: 'garmin' })
    })
  })
})
