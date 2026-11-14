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
  catalogVariantHint,
  findCatalogActivityType,
  findCatalogVariant,
  getCatalogActivityType,
  loadActivityTypeCatalog,
  missingCatalogFields,
  normalizeCatalogText,
  searchActivityTypeCatalog,
  toActivityTypeCatalogEntry,
} from './activity-type-catalog.ts'
import { validatePartialActivityData } from './data-schema-validation.ts'

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
    entry({
      data_schema: {
        fields: [
          { enum_values: ['cold_plunge', 'ice_bath'], name: 'kind', type: 'string' },
          { name: 'temperature', type: 'number' },
        ],
      },
      display_name: 'Cold exposure',
      group: 'recovery',
      name: 'cold_exposure',
      variants: [
        { aliases: [], data: { kind: 'cold_plunge' }, display_name: 'Cold plunge', name: 'cold_plunge' },
        { aliases: ['ice bathing'], data: { kind: 'ice_bath' }, display_name: 'Ice bath', name: 'ice_bath' },
      ],
    }),
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

  test("matches the words of an entry's variants", () => {
    expect(searchActivityTypeCatalog(catalog, 'ice').map((e) => e.name)).toEqual(['cold_exposure'])
    expect(searchActivityTypeCatalog(catalog, 'plunge').map((e) => e.name)).toEqual(['cold_exposure'])
    expect(searchActivityTypeCatalog(catalog, 'bathing').map((e) => e.name)).toEqual(['cold_exposure'])
  })
})

describe('findCatalogVariant', () => {
  test('finds by name, display name or alias, ignoring case and punctuation', () => {
    for (const text of ['ice_bath', 'Ice Bath', 'ICE-BATHING']) {
      const match = findCatalogVariant(catalog, text)
      expect(match?.entry.name, text).toBe('cold_exposure')
      expect(match?.variant.name, text).toBe('ice_bath')
    }
  })

  test('is undefined for an entry name or an unknown text', () => {
    expect(findCatalogVariant(catalog, 'cold_exposure')).toBeUndefined()
    expect(findCatalogVariant(catalog, 'sauna')).toBeUndefined()
  })

  test('leaves findCatalogActivityType to entries only', () => {
    expect(findCatalogActivityType(catalog, 'ice bath')).toBeUndefined()
  })
})

describe('missingCatalogFields', () => {
  const coldExposure = getCatalogActivityType(catalog, 'cold_exposure')!

  test('is every catalogue field without a schema', () => {
    expect(missingCatalogFields(coldExposure, undefined).map((f) => f.name)).toEqual(['kind', 'temperature'])
    expect(missingCatalogFields(coldExposure, null).map((f) => f.name)).toEqual(['kind', 'temperature'])
  })

  test('is the fields the schema has no field of the same name for', () => {
    const schema = { fields: [{ label: 'Temp', name: 'temperature', type: 'string' as const }] }
    expect(missingCatalogFields(coldExposure, schema)).toEqual([
      { enum_values: ['cold_plunge', 'ice_bath'], name: 'kind', type: 'string' },
    ])
  })

  test('is empty when the schema has them all, or the entry has no fields', () => {
    expect(missingCatalogFields(coldExposure, coldExposure.data_schema)).toEqual([])
    expect(missingCatalogFields(getCatalogActivityType(catalog, 'symptom')!, undefined)).toEqual([])
  })
})

describe('catalogVariantHint', () => {
  test('names the built-in type and the data to use', () => {
    expect(catalogVariantHint(catalog, 'ice_bath')).toBe(
      '"ice_bath" is the built-in type "cold_exposure" with kind "ice_bath": use activity_type "cold_exposure" with data {"kind":"ice_bath"}',
    )
  })

  test('is undefined for a name that is no variant', () => {
    expect(catalogVariantHint(catalog, 'cold_exposure')).toBeUndefined()
    expect(catalogVariantHint(catalog, 'driving')).toBeUndefined()
  })
})

describe('toActivityTypeCatalogEntry', () => {
  test('adds in_use', () => {
    const headache = getCatalogActivityType(catalog, 'headache')!
    expect(toActivityTypeCatalogEntry(headache, true, ['severity'])).toEqual({
      ...headache,
      in_use: true,
      missing_fields: ['severity'],
    })
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

  test('has version 2026.11.3 and 41 variants', () => {
    expect(shipped.version).toBe('2026.11.3')
    expect(shipped.entries.flatMap((e) => e.variants ?? [])).toHaveLength(41)
  })

  test('every Oura code appears once in the file and looks like an Oura tag code', () => {
    const codes = shipped.entries.flatMap((e) => [
      ...(e.oura_codes ?? []),
      ...(e.variants ?? []).flatMap((variant) => variant.oura_codes ?? []),
    ])
    expect(codes.length).toBeGreaterThan(0)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(/^tag_[a-z0-9_]+$/)
  })

  test("every Oura name in same_as resolves to its entry or to one of the entry's variants", () => {
    for (const e of shipped.entries) {
      for (const name of e.same_as.oura ?? []) {
        const owner =
          findCatalogActivityType(shipped, name)?.name ?? findCatalogVariant(shipped, name)?.entry.name
        expect(owner, `${name} of ${e.name}`).toBe(e.name)
      }
    }
  })

  test("every variant's data is valid for its entry's schema", () => {
    for (const e of shipped.entries) {
      for (const variant of e.variants ?? []) {
        expect(validatePartialActivityData(variant.data, e.data_schema), `${e.name}/${variant.name}`).toEqual(
          {
            valid: true,
          },
        )
      }
    }
  })

  test('no variant label equals a label of an entry or of another variant', () => {
    const entryLabels = new Set(
      shipped.entries.flatMap((e) => [e.name, e.display_name, ...e.aliases].map(normalizeCatalogText)),
    )
    const owners = new Map<string, string>()
    for (const e of shipped.entries) {
      for (const variant of e.variants ?? []) {
        for (const label of [variant.name, variant.display_name, ...variant.aliases]) {
          const key = normalizeCatalogText(label)
          expect(entryLabels.has(key), `${label} of ${variant.name} is an entry label`).toBe(false)
          const owner = owners.get(key)
          expect(
            owner === undefined || owner === variant.name,
            `${label} is on ${owner} and ${variant.name}`,
          ).toBe(true)
          owners.set(key, variant.name)
        }
      }
    }
  })

  test('has a data_schema for meditation and guided_breathing, which the seeded built-ins take', () => {
    for (const name of ['meditation', 'guided_breathing']) {
      expect(getCatalogActivityType(shipped, name)?.data_schema?.fields.length, name).toBeGreaterThan(0)
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
