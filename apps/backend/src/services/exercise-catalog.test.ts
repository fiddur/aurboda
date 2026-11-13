import type { StoredExerciseCatalog, StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  findExerciseByName,
  getExerciseByKey,
  loadExerciseCatalog,
  normalizeExerciseName,
  searchExercises,
  toExerciseCatalogEntry,
} from './exercise-catalog.ts'

const entry = (
  overrides: Partial<StoredExerciseCatalogEntry> & Pick<StoredExerciseCatalogEntry, 'key' | 'name'>,
): StoredExerciseCatalogEntry => ({
  aliases: [],
  category: 'strength',
  equipment: [],
  muscles: {},
  same_as: { free_exercise_db: overrides.key },
  search_terms: [],
  ...overrides,
})

const catalog: StoredExerciseCatalog = {
  entries: [
    entry({
      aliases: ['Barbell Bench Press - Medium Grip'],
      equipment: ['barbell'],
      key: 'barbell_bench_press',
      muscles: { front_delts: 1, lower_pecs: 1, triceps_long_head: 0.25 },
      name: 'Barbell Bench Press',
    }),
    entry({
      equipment: ['dumbbell'],
      key: 'dumbbell_bench_press',
      muscles: { front_delts: 1, upper_pecs: 1 },
      name: 'Dumbbell Bench Press',
      search_terms: ['DB'],
    }),
    entry({ equipment: ['barbell'], key: 'bench_press', muscles: { chest: 1 }, name: 'Bench Press' }),
    entry({
      equipment: ['barbell'],
      key: 'incline_barbell_press',
      muscles: { upper_pecs: 1 },
      name: 'Incline Barbell Press',
      search_terms: ['bench'],
    }),
    entry({ category: 'stretching', key: 'chest_stretch', muscles: { chest: 0.5 }, name: 'Chest Stretch' }),
    entry({
      equipment: ['cable'],
      key: 'tricep_cable_pushdown',
      muscles: { triceps_medial_lateral: 1 },
      name: 'Tricep Cable Pushdown',
      search_terms: ['push down'],
    }),
  ],
  sources: {
    bodybuild: { commit: 'a', license: 'AGPL-3.0', url: 'u' },
    free_exercise_db: { commit: 'b', license: 'Unlicense', url: 'u' },
  },
  version: '2026.11.0',
}

const keys = (result: { entries: { key: string }[] }) => result.entries.map((e) => e.key)
const search = (query: Parameters<typeof searchExercises>[1]) => searchExercises(catalog, query)

describe('normalizeExerciseName', () => {
  test('lowercases and collapses every non-alphanumeric run to one space', () => {
    expect(normalizeExerciseName('  Barbell Bench-Press  (Medium Grip)! ')).toBe(
      'barbell bench press medium grip',
    )
  })
})

describe('lookups', () => {
  test('by key', () => {
    expect(getExerciseByKey(catalog, 'bench_press')?.name).toBe('Bench Press')
    expect(getExerciseByKey(catalog, 'nope')).toBeUndefined()
  })

  test('by name and by alias, ignoring case and punctuation', () => {
    expect(findExerciseByName(catalog, 'dumbbell bench-press')?.key).toBe('dumbbell_bench_press')
    expect(findExerciseByName(catalog, 'BARBELL BENCH PRESS (medium grip)')?.key).toBe('barbell_bench_press')
  })

  test('search terms are not exact names', () => {
    expect(findExerciseByName(catalog, 'DB')).toBeUndefined()
  })
})

describe('searchExercises', () => {
  test('ranks exact match, then name prefix, then all words in the name, then the rest', () => {
    expect(keys(search({ q: 'bench press' }))).toEqual([
      'bench_press',
      'barbell_bench_press',
      'dumbbell_bench_press',
      'incline_barbell_press',
    ])
    expect(keys(search({ q: 'bench' }))).toEqual([
      'bench_press',
      'barbell_bench_press',
      'dumbbell_bench_press',
      'incline_barbell_press',
    ])
  })

  test('within the name matches, body.build entries go before the rest', () => {
    const curated = entry({
      key: 'smith_machine_bench_press',
      name: 'Smith Machine Bench Press',
      same_as: { bodybuild: 'bench_press_smith' },
    })
    const result = searchExercises({ ...catalog, entries: [...catalog.entries, curated] }, { q: 'bench' })
    expect(keys(result)).toEqual([
      'smith_machine_bench_press',
      'bench_press',
      'barbell_bench_press',
      'dumbbell_bench_press',
      'incline_barbell_press',
    ])
    expect(
      keys(searchExercises({ ...catalog, entries: [...catalog.entries, curated] }, { q: 'bench press' })),
    ).toEqual([
      'bench_press',
      'smith_machine_bench_press',
      'barbell_bench_press',
      'dumbbell_bench_press',
      'incline_barbell_press',
    ])
  })

  test('every word must prefix a word of the name, an alias or a search term', () => {
    expect(keys(search({ q: 'db ben' }))).toEqual(['dumbbell_bench_press'])
    expect(keys(search({ q: 'medium gr' }))).toEqual(['barbell_bench_press'])
    expect(keys(search({ q: 'push' }))).toEqual(['tricep_cable_pushdown'])
    expect(search({ q: 'bench squat' }).total).toBe(0)
  })

  test('without q the order is by name', () => {
    expect(search({}).entries.map((e) => e.name)).toEqual([
      'Barbell Bench Press',
      'Bench Press',
      'Chest Stretch',
      'Dumbbell Bench Press',
      'Incline Barbell Press',
      'Tricep Cable Pushdown',
    ])
  })

  test('filters by equipment and category', () => {
    expect(keys(search({ equipment: 'dumbbell' }))).toEqual(['dumbbell_bench_press'])
    expect(keys(search({ category: 'stretching' }))).toEqual(['chest_stretch'])
  })

  test('filters by a muscle, or a group, at weight 0.5 or more', () => {
    expect(keys(search({ muscle: 'upper_pecs' }))).toEqual(['dumbbell_bench_press', 'incline_barbell_press'])
    expect(keys(search({ muscle: 'chest' }))).toEqual([
      'barbell_bench_press',
      'bench_press',
      'chest_stretch',
      'dumbbell_bench_press',
      'incline_barbell_press',
    ])
    expect(keys(search({ muscle: 'triceps' }))).toEqual(['tricep_cable_pushdown'])
  })

  test('pages with limit and offset, reporting the total', () => {
    const page = search({ limit: 2, offset: 1 })
    expect(page.total).toBe(6)
    expect(page.entries.map((e) => e.name)).toEqual(['Bench Press', 'Chest Stretch'])
    expect(page.version).toBe('2026.11.0')
  })

  test('name is an exact lookup that ignores q', () => {
    expect(keys(search({ name: 'barbell bench press medium grip', q: 'dumbbell' }))).toEqual([
      'barbell_bench_press',
    ])
    expect(search({ name: 'bench' }).total).toBe(0)
  })
})

describe('toExerciseCatalogEntry', () => {
  test('resolves vocabulary names, orders muscles by weight then key, drops search terms', () => {
    const api = toExerciseCatalogEntry(catalog.entries[0] as StoredExerciseCatalogEntry)
    expect(api).toEqual({
      aliases: ['Barbell Bench Press - Medium Grip'],
      category: 'strength',
      equipment: [{ category: 'free_weights', key: 'barbell', name: 'Barbell' }],
      key: 'barbell_bench_press',
      muscles: [
        { group: 'shoulders', key: 'front_delts', name: 'Front delts', weight: 1 },
        { group: 'chest', key: 'lower_pecs', name: 'Lower pecs', weight: 1 },
        { group: 'triceps', key: 'triceps_long_head', name: 'Triceps (long head)', weight: 0.25 },
      ],
      name: 'Barbell Bench Press',
      same_as: { free_exercise_db: 'barbell_bench_press' },
    })
  })
})

describe('the built-in catalogue', () => {
  test('finds the plain barbell bench press by its free-exercise-db name', () => {
    const builtIn = loadExerciseCatalog()
    expect(findExerciseByName(builtIn, 'Barbell Bench Press - Medium Grip')?.same_as.wikidata).toBe('Q14093')
    expect(searchExercises(builtIn, { limit: 5, q: 'deadlift' }).entries[0]?.key).toBe('deadlift')
  })
})
