import {
  dataSchemaDefinitionSchema,
  exerciseTypes,
  type StoredActivityTypeCatalog,
  type StoredActivityTypeCatalogEntry,
  storedActivityTypeCatalogSchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  catalogAdoptionChain,
  findCatalogActivityType,
  getCatalogActivityType,
  loadActivityTypeCatalog,
  normalizeCatalogText,
  searchActivityTypeCatalog,
  toActivityTypeCatalogEntry,
} from './activity-type-catalog.ts'

const entry = (
  overrides: Partial<StoredActivityTypeCatalogEntry> & Pick<StoredActivityTypeCatalogEntry, 'name'>,
): StoredActivityTypeCatalogEntry => ({
  aliases: [],
  color: '#123456',
  display_category: 'health',
  display_name: overrides.name,
  group: 'health',
  icon: '•',
  same_as: {},
  ...overrides,
})

const catalog: StoredActivityTypeCatalog = {
  entries: [
    entry({ display_name: 'Cold exposure', group: 'recovery', name: 'cold_exposure' }),
    entry({ display_name: 'Symptom', name: 'symptom' }),
    entry({ display_name: 'Headache', group: 'symptoms', name: 'headache', parent_type: 'symptom' }),
    entry({
      aliases: ['breathwork'],
      display_name: 'Breathwork',
      name: 'guided_breathing',
      parent_type: 'exercise',
    }),
    entry({ aliases: ['sex'], display_name: 'Sexual activity', name: 'sexual_activity' }),
  ],
  groups: [
    { key: 'health', name: 'Health' },
    { key: 'symptoms', name: 'Symptoms' },
    { key: 'recovery', name: 'Recovery' },
  ],
  version: 'test',
}

describe('normalizeCatalogText', () => {
  test('lower cases and turns runs of punctuation into single spaces', () => {
    expect(normalizeCatalogText('  Cold__Exposure! ')).toBe('cold exposure')
    expect(normalizeCatalogText('Rapid, pounding')).toBe('rapid pounding')
  })
})

describe('getCatalogActivityType', () => {
  test('finds an exact name only', () => {
    expect(getCatalogActivityType(catalog, 'headache')?.name).toBe('headache')
    expect(getCatalogActivityType(catalog, 'Headache')).toBeUndefined()
    expect(getCatalogActivityType(catalog, 'breathwork')).toBeUndefined()
  })
})

describe('findCatalogActivityType', () => {
  test('finds by name, display name or alias, ignoring case and punctuation', () => {
    expect(findCatalogActivityType(catalog, 'Cold Exposure')?.name).toBe('cold_exposure')
    expect(findCatalogActivityType(catalog, 'cold_exposure')?.name).toBe('cold_exposure')
    expect(findCatalogActivityType(catalog, 'Breathwork')?.name).toBe('guided_breathing')
    expect(findCatalogActivityType(catalog, 'sex')?.name).toBe('sexual_activity')
    expect(findCatalogActivityType(catalog, 'SEXUAL ACTIVITY')?.name).toBe('sexual_activity')
  })

  test('is undefined for an unknown text', () => {
    expect(findCatalogActivityType(catalog, 'sauna')).toBeUndefined()
  })
})

describe('catalogAdoptionChain', () => {
  test('puts catalogue ancestors first', () => {
    expect(catalogAdoptionChain(catalog, 'headache').map((e) => e.name)).toEqual(['symptom', 'headache'])
  })

  test('is the entry alone without a parent', () => {
    expect(catalogAdoptionChain(catalog, 'symptom').map((e) => e.name)).toEqual(['symptom'])
  })

  test('stops at a parent that is not a catalogue entry', () => {
    expect(catalogAdoptionChain(catalog, 'guided_breathing').map((e) => e.name)).toEqual(['guided_breathing'])
  })

  test('is empty for an unknown name', () => {
    expect(catalogAdoptionChain(catalog, 'sauna')).toEqual([])
  })
})

describe('searchActivityTypeCatalog', () => {
  test('returns every entry in file order without q', () => {
    expect(searchActivityTypeCatalog(catalog, undefined)).toEqual(catalog.entries)
    expect(searchActivityTypeCatalog(catalog, '  ')).toEqual(catalog.entries)
  })

  test('matches word prefixes of the name, display name and aliases', () => {
    expect(searchActivityTypeCatalog(catalog, 'head').map((e) => e.name)).toEqual(['headache'])
    expect(searchActivityTypeCatalog(catalog, 'breath').map((e) => e.name)).toEqual(['guided_breathing'])
    expect(searchActivityTypeCatalog(catalog, 'guid').map((e) => e.name)).toEqual(['guided_breathing'])
    expect(searchActivityTypeCatalog(catalog, 'ex').map((e) => e.name)).toEqual(['cold_exposure'])
  })

  test('needs every word to match', () => {
    expect(searchActivityTypeCatalog(catalog, 'cold exp').map((e) => e.name)).toEqual(['cold_exposure'])
    expect(searchActivityTypeCatalog(catalog, 'cold head')).toEqual([])
  })

  test('does not match inside a word', () => {
    expect(searchActivityTypeCatalog(catalog, 'ache')).toEqual([])
  })
})

describe('toActivityTypeCatalogEntry', () => {
  test('adds in_use', () => {
    const headache = getCatalogActivityType(catalog, 'headache')!
    expect(toActivityTypeCatalogEntry(headache, true)).toEqual({ ...headache, in_use: true })
  })
})

describe('the shipped catalogue', () => {
  const shipped = loadActivityTypeCatalog()

  test('parses with the catalogue schema', () => {
    expect(storedActivityTypeCatalogSchema.safeParse(shipped).error).toBeUndefined()
  })

  test('has 61 entries with unique names', () => {
    expect(shipped.entries).toHaveLength(61)
    expect(new Set(shipped.entries.map((e) => e.name)).size).toBe(61)
  })

  test('no normalized name, display name or alias resolves to two entries', () => {
    const owners = new Map<string, string>()
    for (const e of shipped.entries) {
      for (const label of [e.name, e.display_name, ...e.aliases]) {
        const key = normalizeCatalogText(label)
        const owner = owners.get(key)
        expect(owner === undefined || owner === e.name, `${label} is on ${owner} and ${e.name}`).toBe(true)
        owners.set(key, e.name)
      }
    }
  })

  test('every group is listed and every parent is a catalogue entry or exercise for guided_breathing', () => {
    const groups = new Set(shipped.groups.map((g) => g.key))
    const names = new Set(shipped.entries.map((e) => e.name))
    for (const e of shipped.entries) {
      expect(groups.has(e.group)).toBe(true)
      if (e.parent_type === undefined) continue
      if (e.name === 'guided_breathing') expect(e.parent_type).toBe('exercise')
      else expect(names.has(e.parent_type), `${e.name} -> ${e.parent_type}`).toBe(true)
    }
  })

  test('has 37 symptoms, each with a severity from 0 to 10', () => {
    const symptoms = shipped.entries.filter((e) => e.parent_type === 'symptom')
    expect(symptoms).toHaveLength(37)
    for (const e of symptoms) {
      expect(e.data_schema?.fields.find((f) => f.name === 'severity')).toMatchObject({
        max: 10,
        min: 0,
        type: 'number',
      })
    }
  })

  test('collides with no core or Health Connect exercise type except guided_breathing', () => {
    const reserved = [
      'sleep',
      'exercise',
      'nap',
      'rest',
      'calendar_event',
      'music_scrobble',
      'screentime',
      'location_visit',
    ]
    for (const e of shipped.entries) {
      expect(reserved).not.toContain(e.name)
      if (e.name !== 'guided_breathing') expect(Object.keys(exerciseTypes)).not.toContain(e.name)
    }
  })

  test('has valid data schemas with enums and bounds', () => {
    const alcohol = getCatalogActivityType(shipped, 'alcohol')!
    expect(dataSchemaDefinitionSchema.safeParse(alcohol.data_schema).success).toBe(true)
    expect(alcohol.data_schema?.fields.find((f) => f.name === 'kind')?.enum_values).toContain('beer')
    const headache = getCatalogActivityType(shipped, 'headache')!
    expect(dataSchemaDefinitionSchema.safeParse(headache.data_schema).success).toBe(true)
  })
})
