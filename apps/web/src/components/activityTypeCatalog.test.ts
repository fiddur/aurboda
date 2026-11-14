import type { ActivityTypeCatalogEntry, ActivityTypeCatalogResult } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ActivityTypeDefinition } from '../state/api/types'

import {
  catalogEntryAsDefinition,
  catalogFieldSummary,
  catalogSuggestions,
  definitionOrCatalogEntry,
  groupCatalogEntries,
  withCatalogTypes,
} from './activityTypeCatalog'

const entry = (over: Partial<ActivityTypeCatalogEntry> & { name: string }): ActivityTypeCatalogEntry => ({
  aliases: [],
  color: '#123456',
  display_category: 'other',
  display_name: over.name,
  group: 'intake',
  icon: '*',
  in_use: false,
  same_as: {},
  ...over,
})

const sauna = entry({
  data_schema: {
    fields: [
      { label: 'Temperature', name: 'temperature', type: 'number', unit: 'C' },
      { name: 'rounds', type: 'number' },
    ],
  },
  display_category: 'wellness',
  display_name: 'Sauna',
  group: 'recovery',
  name: 'sauna',
})
const breath = entry({
  aliases: ['breathwork'],
  display_name: 'Breathwork',
  group: 'recovery',
  name: 'guided_breathing',
  parent_type: 'exercise',
})
const coffee = entry({ display_name: 'Coffee', name: 'coffee' })
const energyDrink = entry({ display_name: 'Energy drink', name: 'energy_drink' })
const headache = entry({ display_name: 'Headache', group: 'symptoms', name: 'headache' })
const alcohol = entry({ display_name: 'Alcohol', in_use: true, name: 'alcohol' })

const userDef: ActivityTypeDefinition = {
  color: '#000000',
  display_category: 'exercise',
  display_name: 'Running',
  is_builtin: true,
  name: 'running',
  show_on_timeline: true,
}

describe('catalogSuggestions', () => {
  const entries = [sauna, breath, coffee, energyDrink, headache, alcohol]

  test('empty query gives nothing', () => {
    expect(catalogSuggestions(entries, '  ')).toEqual([])
  })

  test('matches name, display name and alias, case-insensitively', () => {
    expect(catalogSuggestions(entries, 'SAU')).toEqual([sauna])
    expect(catalogSuggestions(entries, 'breathw')).toEqual([breath])
    expect(catalogSuggestions(entries, 'guided')).toEqual([breath])
  })

  test('compares the query in snake_case against the name', () => {
    expect(catalogSuggestions(entries, 'energy dr')).toEqual([energyDrink])
  })

  test('leaves out entries in use', () => {
    expect(catalogSuggestions(entries, 'alco')).toEqual([])
  })

  test('exact matches first, then file order, and the limit', () => {
    const coffeeShop = entry({ display_name: 'Coffee shop', name: 'coffee_shop' })
    expect(catalogSuggestions([coffeeShop, coffee], 'coffee')).toEqual([coffee, coffeeShop])
    expect(catalogSuggestions([coffeeShop, coffee], 'coff')).toEqual([coffeeShop, coffee])
    expect(catalogSuggestions(entries, 'e', 2)).toEqual([breath, coffee])
  })
})

describe('catalogEntryAsDefinition', () => {
  test('shapes an entry as a definition', () => {
    expect(catalogEntryAsDefinition(sauna)).toEqual({
      color: '#123456',
      data_schema: sauna.data_schema,
      display_category: 'wellness',
      display_name: 'Sauna',
      icon: '*',
      is_builtin: false,
      name: 'sauna',
      show_on_timeline: true,
    })
    expect(catalogEntryAsDefinition(breath).parent_type).toBe('exercise')
  })
})

describe('definitionOrCatalogEntry', () => {
  test("the user's definition first, else the catalogue entry, else nothing", () => {
    const ownSauna = { ...userDef, name: 'sauna' }
    expect(definitionOrCatalogEntry('sauna', [ownSauna], [sauna])).toBe(ownSauna)
    expect(definitionOrCatalogEntry('sauna', [userDef], [sauna])).toEqual(catalogEntryAsDefinition(sauna))
    expect(definitionOrCatalogEntry('nothing', [userDef], [sauna])).toBeUndefined()
  })
})

describe('withCatalogTypes', () => {
  test('user definitions first, then catalogue entries not in use and not already defined', () => {
    const ownSauna = { ...userDef, display_name: 'My sauna', name: 'sauna' }
    const result = withCatalogTypes([userDef, ownSauna], [sauna, coffee, alcohol])
    expect(result.map((r) => [r.def.name, r.fromCatalog])).toEqual([
      ['running', false],
      ['sauna', false],
      ['coffee', true],
    ])
  })
})

describe('groupCatalogEntries', () => {
  const result: ActivityTypeCatalogResult = {
    entries: [coffee, sauna, headache, breath],
    groups: [
      { key: 'intake', name: 'Intake' },
      { key: 'meals', name: 'Meals and diet' },
      { key: 'symptoms', name: 'Symptoms' },
      { key: 'recovery', name: 'Recovery and practice' },
    ],
    version: '1',
  }

  test('groups in catalogue order, entries in file order, empty groups left out', () => {
    expect(groupCatalogEntries(result, '')).toEqual([
      { entries: [coffee], key: 'intake', name: 'Intake' },
      { entries: [headache], key: 'symptoms', name: 'Symptoms' },
      { entries: [sauna, breath], key: 'recovery', name: 'Recovery and practice' },
    ])
  })

  test('the query filters on name or display name', () => {
    expect(groupCatalogEntries(result, 'BREATH')).toEqual([
      { entries: [breath], key: 'recovery', name: 'Recovery and practice' },
    ])
    expect(groupCatalogEntries(result, 'guided')).toHaveLength(1)
    expect(groupCatalogEntries(result, 'nothing')).toEqual([])
  })
})

describe('catalogFieldSummary', () => {
  test('the field names as words', () => {
    expect(catalogFieldSummary(sauna)).toBe('temperature, rounds')
    expect(
      catalogFieldSummary(
        entry({ data_schema: { fields: [{ name: 'pain_level', type: 'number' }] }, name: 'x' }),
      ),
    ).toBe('pain level')
  })

  test('empty without a schema', () => {
    expect(catalogFieldSummary(coffee)).toBe('')
  })
})
