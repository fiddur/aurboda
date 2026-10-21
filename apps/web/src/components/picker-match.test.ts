import { describe, expect, test } from 'vitest'

import { matchActivityTypes, matchMetricEntries } from './picker-match'

const defs = [
  { display_name: 'Running', name: 'running' },
  { display_name: 'Trail Running', name: 'trail_running' },
  { display_name: 'Yoga', name: 'yoga' },
  { display_name: 'Morning pages', name: 'journaling' },
]

const names = (list: { name: string }[]) => list.map((d) => d.name)

describe('matchActivityTypes', () => {
  test('a trailing space still finds the type and offers no create', () => {
    const match = matchActivityTypes(defs, 'Yoga ')
    expect(names(match.filtered)).toEqual(['yoga'])
    expect(match.isNewType).toBe(false)
  })

  test('a leading space still finds the type', () => {
    const match = matchActivityTypes(defs, ' running')
    expect(names(match.filtered)).toEqual(['running', 'trail_running'])
    expect(match.isNewType).toBe(false)
  })

  test('an exact match comes first so Enter selects it', () => {
    expect(names(matchActivityTypes(defs, 'trail running ').filtered)).toEqual(['trail_running'])
    expect(names(matchActivityTypes(defs, 'RUNNING').filtered)[0]).toBe('running')
  })

  test('an exact display name match is selectable and not offered as new', () => {
    const match = matchActivityTypes(defs, 'morning pages ')
    expect(names(match.filtered)).toEqual(['journaling'])
    expect(match.isNewType).toBe(false)
  })

  test('a genuinely new name offers create with the snake-cased trimmed input', () => {
    const match = matchActivityTypes(defs, ' Rock climbing ')
    expect(match.filtered).toEqual([])
    expect(match.isNewType).toBe(true)
    expect(match.snakeInput).toBe('rock_climbing')
  })

  test('a blank input lists everything and offers nothing new', () => {
    const match = matchActivityTypes(defs, '   ')
    expect(match.filtered).toEqual(defs)
    expect(match.isNewType).toBe(false)
  })

  test('no create while the types are still loading', () => {
    expect(matchActivityTypes([], 'yoga', true).isNewType).toBe(false)
  })
})

describe('matchMetricEntries', () => {
  const entries = [
    { label: 'Heart rate', value: 'heart_rate' },
    { label: 'Weight', value: 'weight' },
  ]

  test('matches on the trimmed query', () => {
    expect(matchMetricEntries(entries, 'weight ')).toEqual([entries[1]])
    expect(matchMetricEntries(entries, ' Heart')).toEqual([entries[0]])
  })

  test('a blank query matches everything', () => {
    expect(matchMetricEntries(entries, ' ')).toEqual(entries)
  })
})
