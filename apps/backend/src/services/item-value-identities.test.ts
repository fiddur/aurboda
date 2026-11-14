import type {
  DataSchemaDefinition,
  StoredExerciseCatalog,
  StoredExerciseCatalogEntry,
} from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  applyItemValueKeys,
  applyItemValueKeysForWrite,
  catalogItemPaths,
  type ItemValueIdentityContext,
  resolveItemValueIdentity,
  storedIdentityMap,
} from './item-value-identities.ts'

vi.mock('../db/index.ts', () => ({
  expandActivityTypes: vi.fn(),
  getActivityFieldValues: vi.fn(),
  getActivityTypeDefinition: vi.fn(),
  listItemValueIdentities: vi.fn(),
}))

const entry = (key: string, name: string, aliases: string[] = []): StoredExerciseCatalogEntry => ({
  aliases,
  category: 'strength',
  equipment: [],
  key,
  muscles: {},
  name,
  same_as: { free_exercise_db: key },
  search_terms: [],
})

const catalog: StoredExerciseCatalog = {
  entries: [
    entry('barbell_bench_press', 'Barbell Bench Press', ['Bench Press']),
    entry('lat_pulldown', 'Lat Pulldown'),
    entry('barbell_squat', 'Barbell Squat'),
  ],
  sources: {
    bodybuild: { commit: 'a', license: 'AGPL-3.0', url: 'u' },
    free_exercise_db: { commit: 'b', license: 'Unlicense', url: 'u' },
    garmin_connect: { fetched: '2026-11-13', names_url: 'n', url: 'u' },
  },
  version: '2026.11.0',
}

const schema: DataSchemaDefinition = {
  fields: [
    { name: 'session_name', type: 'string' },
    {
      item_fields: [
        { catalog: 'exercises', is_categorical: true, name: 'exercise', required: true, type: 'string' },
        { name: 'weight', type: 'number' },
      ],
      name: 'sets',
      type: 'list',
    },
  ],
}

const at = (iso: string) => new Date(iso)

const stored = (value: string, catalog_key: string | null, updated = '2026-10-01T00:00:00Z') => ({
  catalog_key,
  updated_at: at(updated),
  value,
})

describe('resolveItemValueIdentity', () => {
  const map = storedIdentityMap([
    stored('Pulldown', 'lat_pulldown'),
    stored(' bench press ', null),
    stored('Old Thing', 'removed_from_catalogue'),
  ])
  const resolve = (value: string) => resolveItemValueIdentity(value, map, catalog)

  test('a stored key is the user state, compared trimmed and case-insensitively', () => {
    expect(resolve('  pulldown')).toEqual({ catalog_key: 'lat_pulldown', state: 'user' })
  })

  test('a stored null is dismissed, even when the catalogue has the name', () => {
    expect(resolve('Bench Press')).toEqual({ catalog_key: null, state: 'dismissed' })
  })

  test('a catalogue name or alias resolves to its entry', () => {
    expect(resolve('lat pulldown')).toEqual({ catalog_key: 'lat_pulldown', state: 'catalog' })
    expect(resolve('Barbell Squat')).toEqual({ catalog_key: 'barbell_squat', state: 'catalog' })
  })

  test('anything else is unmapped, including a stored key the catalogue no longer has', () => {
    expect(resolve('Zercher Carry')).toEqual({ catalog_key: null, state: 'unmapped' })
    expect(resolve('Old Thing')).toEqual({ catalog_key: null, state: 'unmapped' })
  })
})

describe('catalogItemPaths', () => {
  test('lists the catalogue-backed item fields', () => {
    expect(catalogItemPaths(schema)).toEqual([{ catalog: 'exercises', key: 'exercise', list: 'sets' }])
    expect(catalogItemPaths(undefined)).toEqual([])
  })
})

describe('applyItemValueKeys', () => {
  const empty: ItemValueIdentityContext = { logged: [], stored: [] }
  const apply = (data: Record<string, unknown> | undefined, context: ItemValueIdentityContext = empty) =>
    applyItemValueKeys(schema, data, () => catalog, { 'sets.exercise': context })

  test('an unknown key fails with the item path', () => {
    expect(
      apply({ sets: [{ exercise: 'A' }, { exercise: 'B' }, { exercise_key: 'nope', weight: 10 }] }),
    ).toEqual({
      error: 'sets[2].exercise_key: unknown exercise catalogue key "nope"',
      success: false,
    })
  })

  test('a key alone takes the catalogue name when the user has none, and the key is stripped', () => {
    expect(apply({ sets: [{ exercise_key: 'lat_pulldown', weight: 50 }] })).toEqual({
      data: { data: { sets: [{ exercise: 'Lat Pulldown', weight: 50 }] }, mappings: [] },
      success: true,
    })
  })

  test("a key alone takes the user's most recently decided logged name for it", () => {
    const context = {
      logged: [
        { count: 9, value: 'Lat Pulldown' },
        { count: 3, value: 'Pulldown' },
        { count: 2, value: 'Lats' },
      ],
      stored: [
        stored('Lats', 'lat_pulldown', '2026-09-01T00:00:00Z'),
        stored('pulldown', 'lat_pulldown', '2026-10-01T00:00:00Z'),
        stored('Never Logged', 'lat_pulldown', '2026-11-01T00:00:00Z'),
      ],
    }
    expect(apply({ sets: [{ exercise_key: 'lat_pulldown' }] }, context)).toMatchObject({
      data: { data: { sets: [{ exercise: 'pulldown' }] } },
    })
  })

  test('without a decided name, a key alone takes the most used logged name resolving to it', () => {
    const context = {
      logged: [
        { count: 2, value: 'Lat Pulldown' },
        { count: 5, value: 'Barbell Squat' },
        { count: 4, value: 'lat pulldown ' },
      ],
      stored: [],
    }
    expect(apply({ sets: [{ exercise: '  ', exercise_key: 'lat_pulldown' }] }, context)).toMatchObject({
      data: { data: { sets: [{ exercise: 'lat pulldown' }] } },
    })
  })

  test('a key next to a name that does not resolve to it stores a mapping once per name', () => {
    expect(
      apply({
        sets: [
          { exercise: 'Pulldown', exercise_key: 'lat_pulldown' },
          { exercise: 'pulldown ', exercise_key: 'lat_pulldown' },
          { exercise: 'Bench Press', exercise_key: 'barbell_squat' },
        ],
      }),
    ).toEqual({
      data: {
        data: { sets: [{ exercise: 'Pulldown' }, { exercise: 'pulldown ' }, { exercise: 'Bench Press' }] },
        mappings: [
          { field: 'sets.exercise', key: 'lat_pulldown', value: 'Pulldown' },
          { field: 'sets.exercise', key: 'barbell_squat', value: 'Bench Press' },
        ],
      },
      success: true,
    })
  })

  test('a key next to a name already resolving to it stores nothing', () => {
    const context = { logged: [], stored: [stored('Pulldown', 'lat_pulldown')] }
    expect(
      apply(
        {
          sets: [
            { exercise: 'Bench Press', exercise_key: 'barbell_bench_press' },
            { exercise: 'PULLDOWN', exercise_key: 'lat_pulldown' },
          ],
        },
        context,
      ),
    ).toMatchObject({ data: { mappings: [] }, success: true })
  })

  test('a null key is stripped and changes nothing else', () => {
    expect(apply({ sets: [{ exercise: 'Zercher Carry', exercise_key: null }] })).toEqual({
      data: { data: { sets: [{ exercise: 'Zercher Carry' }] }, mappings: [] },
      success: true,
    })
  })

  test('a name that is not text is left for the data validation, with the key stripped', () => {
    expect(apply({ sets: [{ exercise: 42, exercise_key: 'lat_pulldown' }] })).toEqual({
      data: { data: { sets: [{ exercise: 42 }] }, mappings: [] },
      success: true,
    })
  })

  test('data without lists or keys comes back by reference', () => {
    const plain = { session_name: 'Push' }
    const unkeyed = { sets: [{ exercise: 'Lat Pulldown' }, 'not an item'] }
    for (const data of [plain, unkeyed]) {
      const result = apply(data)
      expect(result.success && result.data.data).toBe(data)
    }
    expect(apply(undefined)).toEqual({ data: { data: undefined, mappings: [] }, success: true })
  })
})

describe('applyItemValueKeysForWrite', () => {
  beforeEach(() => vi.clearAllMocks())

  test('reads nothing when the data has no list', async () => {
    const data = { session_name: 'Push' }
    expect(await applyItemValueKeysForWrite('tester', 'strength_training', data)).toEqual({
      data: { data, mappings: [] },
      success: true,
    })
    expect(db.getActivityTypeDefinition).not.toHaveBeenCalled()
  })

  test('reads the identities and logged values only when an item carries a key', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue({
      color: '#000000',
      data_schema: schema,
      display_category: 'exercise',
      display_name: 'Strength',
      is_builtin: true,
      name: 'strength_training',
      show_on_timeline: true,
    })
    vi.mocked(db.expandActivityTypes).mockResolvedValue(['strength_training'])
    vi.mocked(db.listItemValueIdentities).mockResolvedValue([])
    vi.mocked(db.getActivityFieldValues).mockResolvedValue([
      { count: 3, last_used: at('2026-10-01T00:00:00Z'), value: 'Squats' },
    ])

    const unkeyed = { sets: [{ exercise: 'Squats' }] }
    expect(await applyItemValueKeysForWrite('tester', 'strength_training', unkeyed)).toMatchObject({
      data: { data: unkeyed },
    })
    expect(db.listItemValueIdentities).not.toHaveBeenCalled()

    expect(
      await applyItemValueKeysForWrite('tester', 'strength_training', {
        sets: [{ exercise: 'Squats', exercise_key: 'barbell_squat' }],
      }),
    ).toMatchObject({ success: true })
    expect(db.listItemValueIdentities).toHaveBeenCalledWith('tester', 'sets.exercise')
    expect(db.getActivityFieldValues).toHaveBeenCalledWith(
      'tester',
      ['strength_training'],
      'sets.exercise',
      2000,
    )
  })

  test('uses a schema it is given for a type that is not stored yet', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(null)
    vi.mocked(db.expandActivityTypes).mockResolvedValue(['not_stored_yet'])
    vi.mocked(db.listItemValueIdentities).mockResolvedValue([])
    vi.mocked(db.getActivityFieldValues).mockResolvedValue([])
    const keyed = { sets: [{ exercise: 'Squats', exercise_key: 'barbell_squat' }] }

    expect(await applyItemValueKeysForWrite('tester', 'not_stored_yet', keyed, schema)).toMatchObject({
      success: true,
    })
    expect(db.getActivityTypeDefinition).not.toHaveBeenCalled()
    expect(db.listItemValueIdentities).toHaveBeenCalledWith('tester', 'sets.exercise')
  })
})
