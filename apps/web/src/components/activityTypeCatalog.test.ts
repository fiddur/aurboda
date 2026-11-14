import type { ActivityTypeCatalogEntry, ActivityTypeCatalogResult } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ActivityTypeDefinition } from '../state/api/types'

import {
  catalogEntryAsDefinition,
  catalogFieldSummary,
  catalogRelation,
  catalogSuggestionRows,
  catalogSuggestions,
  catalogVariantSuggestions,
  definitionOrCatalogEntry,
  groupCatalogEntries,
  variantDataSummary,
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
  missing_fields: [],
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

const beer = { aliases: [], data: { kind: 'beer' }, display_name: 'Beer', name: 'beer' }
const lowCarb = {
  aliases: ['low carb'],
  data: { kind: 'low_carb' },
  display_name: 'Low-carb diet',
  name: 'low_carb_diet',
}
const iceBath = { aliases: [], data: { kind: 'ice_bath' }, display_name: 'Ice bath', name: 'ice_bath' }
const kindField = { enum_values: ['beer', 'low_carb', 'ice_bath'], name: 'kind', type: 'string' as const }
const drinks = entry({
  data_schema: { fields: [kindField, { name: 'drinks', type: 'number' }] },
  display_name: 'Alcohol',
  name: 'alcohol',
  variants: [beer],
})
const diet = entry({
  data_schema: { fields: [{ ...kindField, label: 'Diet_Kind' }] },
  display_name: 'Diet',
  name: 'diet',
  variants: [lowCarb],
})
const cold = entry({
  data_schema: { fields: [kindField] },
  display_name: 'Cold exposure',
  name: 'cold_exposure',
  variants: [iceBath],
})

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

describe('catalogSuggestions through variants', () => {
  test('finds an entry through a variant, after the entries that match themselves', () => {
    const beerGarden = entry({ display_name: 'Beer garden', name: 'beer_garden' })
    expect(catalogSuggestions([drinks, beerGarden], 'beer')).toEqual([beerGarden, drinks])
    expect(catalogSuggestions([drinks, diet], 'low carb')).toEqual([diet])
  })

  test('still leaves out entries in use', () => {
    expect(catalogSuggestions([{ ...drinks, in_use: true }], 'beer')).toEqual([])
  })
})

describe('catalogVariantSuggestions', () => {
  test('matches variant name, display name and alias, in use or not', () => {
    const inUse = { ...drinks, in_use: true }
    expect(catalogVariantSuggestions([inUse, diet, cold], 'BEER')).toEqual([{ entry: inUse, variant: beer }])
    expect(catalogVariantSuggestions([inUse, diet, cold], 'low carb')).toEqual([
      { entry: diet, variant: lowCarb },
    ])
    expect(catalogVariantSuggestions([inUse, diet, cold], 'ice_b')).toEqual([
      { entry: cold, variant: iceBath },
    ])
  })

  test('exact matches first, the limit, and nothing for an empty query', () => {
    const bath = { aliases: [], data: { kind: 'ice_bath' }, display_name: 'Ice', name: 'ice' }
    const both = { ...cold, variants: [iceBath, bath] }
    expect(catalogVariantSuggestions([both], 'ice').map((m) => m.variant)).toEqual([bath, iceBath])
    expect(catalogVariantSuggestions([both], 'ice', 1)).toHaveLength(1)
    expect(catalogVariantSuggestions([both], ' ')).toEqual([])
  })
})

describe('catalogSuggestionRows', () => {
  test('marks the variant a suggestion was reached through', () => {
    expect(catalogSuggestionRows([drinks], 'beer')).toEqual([{ entry: drinks, variant: beer }])
    expect(catalogSuggestionRows([drinks], 'alco')).toEqual([{ entry: drinks, variant: undefined }])
  })

  test('adds an entry in use reached through a variant, once', () => {
    const inUse = { ...drinks, in_use: true }
    expect(catalogSuggestionRows([inUse, sauna], 'beer')).toEqual([{ entry: inUse, variant: beer }])
    expect(catalogSuggestionRows([inUse], 'alco')).toEqual([])
  })
})

describe('catalogRelation', () => {
  const def = (name: string, display_name = name, is_builtin = false) => ({ display_name, is_builtin, name })

  test('fields: an entry of the same name with missing fields', () => {
    const withMissing = { ...sauna, in_use: true, missing_fields: ['rounds'] }
    expect(catalogRelation(def('sauna'), [withMissing])).toEqual({
      entry: withMissing,
      kind: 'fields',
      missing: [{ name: 'rounds', type: 'number' }],
    })
  })

  test('nothing for an entry of the same name with every field, even if a variant matches too', () => {
    const named = { ...drinks, name: 'beer' }
    expect(catalogRelation(def('beer'), [named, drinks])).toBeUndefined()
  })

  test('variant: by name, display name or alias, normalised', () => {
    expect(catalogRelation(def('beer'), [drinks])).toEqual({ entry: drinks, kind: 'variant', variant: beer })
    expect(catalogRelation(def('my_drink', 'Beer'), [drinks])).toMatchObject({
      kind: 'variant',
      variant: beer,
    })
    expect(catalogRelation(def('lowcarb', 'Low carb'), [diet])).toMatchObject({ variant: lowCarb })
    expect(catalogRelation(def('ice_bath'), [cold])).toMatchObject({ variant: iceBath })
    expect(catalogRelation(def('isbad', 'Ice Bath'), [cold])).toMatchObject({ variant: iceBath })
  })

  test('alias: an entry whose display name or alias matches', () => {
    expect(catalogRelation(def('breathwork'), [breath])).toEqual({ entry: breath, kind: 'alias' })
    expect(catalogRelation(def('bastu', 'SAUNA'), [sauna])).toEqual({ entry: sauna, kind: 'alias' })
  })

  test('a built-in is never offered a merge', () => {
    expect(catalogRelation(def('ice_bath', 'Ice bath', true), [cold])).toBeUndefined()
    expect(catalogRelation(def('breathwork', 'Breathwork', true), [breath])).toBeUndefined()
  })

  test('nothing for an unrelated type', () => {
    expect(catalogRelation(def('driving'), [drinks, sauna, breath])).toBeUndefined()
  })

  describe('by Oura tag code', () => {
    const coded = {
      ...drinks,
      oura_codes: ['tag_sleep_alcohol'],
      variants: [{ ...beer, oura_codes: ['tag_generic_beer'] }],
    }
    const codedBeer = coded.variants[0]!

    test('a type named after a variant code is that variant', () => {
      expect(catalogRelation(def('tag_generic_beer'), [sauna, coded])).toEqual({
        entry: coded,
        kind: 'variant',
        oura_code: 'tag_generic_beer',
        variant: codedBeer,
      })
    })

    test('a type named after an entry code is that entry', () => {
      expect(catalogRelation(def('tag_sleep_alcohol'), [sauna, coded])).toEqual({
        entry: coded,
        kind: 'alias',
        oura_code: 'tag_sleep_alcohol',
      })
    })

    test('a built-in type is never matched by code', () => {
      expect(catalogRelation(def('tag_generic_beer', 'tag_generic_beer', true), [coded])).toBeUndefined()
    })

    test('a match by label carries no code', () => {
      expect(catalogRelation(def('beer'), [coded])).not.toHaveProperty('oura_code')
    })
  })
})

describe('variantDataSummary', () => {
  test('the field label or name, then the value as words', () => {
    expect(variantDataSummary(drinks, beer)).toBe('kind beer')
    expect(variantDataSummary(diet, lowCarb)).toBe('diet kind low carb')
    expect(variantDataSummary(cold, iceBath)).toBe('kind ice bath')
  })

  test('several values joined', () => {
    const v = { aliases: [], data: { kind: 'beer', size_class: 'pint' }, display_name: 'Pint', name: 'pint' }
    expect(variantDataSummary(drinks, v)).toBe('kind beer, size class pint')
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
