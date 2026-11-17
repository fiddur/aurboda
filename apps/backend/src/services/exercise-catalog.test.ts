import type { StoredExerciseCatalog, StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  findExerciseByFit,
  findExerciseByName,
  getExerciseByKey,
  loadExerciseCatalog,
  normalizeExerciseName,
  searchExercises,
  suggestExercises,
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
    entry({
      equipment: ['barbell'],
      key: 'bench_press',
      muscles: { chest: 1 },
      name: 'Bench Press',
      same_as: {
        fit: ['bench_press/barbell_bench_press', 'bench_press/weighted_bench_press'],
        free_exercise_db: 'b',
      },
    }),
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
    garmin_connect: { fetched: '2026-11-13', names_url: 'n', url: 'u' },
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

  test('by FIT key, in any letter case', () => {
    expect(findExerciseByFit(catalog, 'bench_press/weighted_bench_press')?.key).toBe('bench_press')
    expect(findExerciseByFit(catalog, ' BENCH_PRESS/Barbell_Bench_Press ')?.key).toBe('bench_press')
    expect(findExerciseByFit(catalog, 'bench_press/dumbbell_bench_press')).toBeUndefined()
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
      'barbell_bench_press',
      'dumbbell_bench_press',
      'smith_machine_bench_press',
      'incline_barbell_press',
    ])
  })

  test('the query plus only its own free weight ranks with an exact match, curated first', () => {
    const extra = [
      entry({ key: 'squat', name: 'Squat', same_as: { fit: ['squat/squat'] } }),
      entry({ key: 'belt_squat', name: 'Belt Squat', same_as: { bodybuild: 'belt squat' } }),
      entry({
        aliases: ['Barbell Back Squat'],
        equipment: ['barbell', 'squat_rack'],
        key: 'barbell_squat',
        name: 'Barbell Squat',
        same_as: { bodybuild: 'barbell squat' },
      }),
      entry({
        equipment: ['belt_squat_machine'],
        key: 'machine_belt_squat',
        name: 'Machine Belt Squat',
        same_as: { bodybuild: 'machine belt squat' },
      }),
      entry({ key: 'dumbbell_squat', name: 'Dumbbell Squat', same_as: { bodybuild: 'dumbbell squat' } }),
    ]
    expect(
      keys(searchExercises({ ...catalog, entries: [...catalog.entries, ...extra] }, { q: 'squat' })),
    ).toEqual(['barbell_squat', 'squat', 'belt_squat', 'dumbbell_squat', 'machine_belt_squat'])
  })

  test('within a tier, free-exercise-db entries go before Garmin-only ones', () => {
    const garminOnly = entry({
      key: 'bench_press_hold',
      name: 'Bench Press Hold',
      same_as: { fit: ['bench_press/hold'] },
    })
    const result = searchExercises({ ...catalog, entries: [garminOnly, ...catalog.entries] }, { q: 'bench' })
    expect(keys(result)).toEqual([
      'bench_press',
      'barbell_bench_press',
      'dumbbell_bench_press',
      'bench_press_hold',
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

  test('fit is an exact lookup in any letter case that ignores q', () => {
    expect(keys(search({ fit: 'BENCH_PRESS/WEIGHTED_BENCH_PRESS', q: 'dumbbell' }))).toEqual(['bench_press'])
    expect(search({ fit: 'bench_press/unknown' }).total).toBe(0)
  })

  test('with both name and fit the entry must match both', () => {
    expect(keys(search({ fit: 'bench_press/barbell_bench_press', name: 'Bench Press' }))).toEqual([
      'bench_press',
    ])
    expect(search({ fit: 'bench_press/barbell_bench_press', name: 'Barbell Bench Press' }).total).toBe(0)
    expect(search({ fit: 'bench_press/unknown', name: 'Bench Press' }).total).toBe(0)
  })
})

describe('search word forms', () => {
  const formsCatalog: StoredExerciseCatalog = {
    ...catalog,
    entries: [
      entry({ key: 'squat', name: 'Squat', same_as: { fit: ['squat/squat'] } }),
      entry({
        equipment: ['barbell'],
        key: 'barbell_squat',
        name: 'Barbell Squat',
        same_as: { bodybuild: 'barbell squat' },
      }),
      entry({ key: 'tricep_extension', name: 'Tricep Extension' }),
      entry({ key: 'machine_triceps_extension', name: 'Machine Triceps Extension' }),
      entry({ key: 'crunch', name: 'Crunch' }),
      entry({ key: 'ab_crunch', name: 'Ab Crunch' }),
      entry({ key: 'hip_abduction', name: 'Hip Abduction' }),
      entry({ key: 'pull_up', name: 'Pull-Up' }),
      entry({ key: 'deadlift', name: 'Deadlift' }),
      entry({ key: 'lat_pulldown', name: 'Lat Pulldown' }),
      entry({ key: 'lat_pull_down', name: 'Lat Pull-down' }),
      entry({ equipment: ['dumbbell'], key: 'dumbbell_curl', name: 'Dumbbell Curl' }),
      entry({ equipment: ['barbell'], key: 'barbell_curl', name: 'Barbell Curl' }),
      entry({ equipment: ['kettlebell'], key: 'kettlebell_swing', name: 'Kettlebell Swing' }),
      entry({ equipment: ['dumbbell'], key: 'one_arm_dumbbell_row', name: 'One-Arm Dumbbell Row' }),
      entry({ equipment: ['cable'], key: 'single_arm_cable_row', name: 'Single-arm Cable Row' }),
      entry({ equipment: ['dumbbell'], key: 'dumbbell_fly', name: 'Dumbbell Fly' }),
    ],
  }
  const find = (q: string) => keys(searchExercises(formsCatalog, { q }))

  test('a plural meets its singular', () => {
    expect(find('squats')).toEqual(find('squat'))
    expect(find('squats')).toEqual(['barbell_squat', 'squat'])
    expect(find('triceps extension')).toEqual(['tricep_extension', 'machine_triceps_extension'])
    expect(find('crunches')).toEqual(['crunch', 'ab_crunch'])
  })

  test('a plural meets its singular exactly, not as a prefix', () => {
    expect(find('abs')).toEqual(['ab_crunch'])
  })

  test('words written together or apart meet', () => {
    expect(find('pullup')).toEqual(['pull_up'])
    expect(find('pullups')).toEqual(['pull_up'])
    expect(find('pull up')).toEqual(['pull_up'])
    expect(find('dead lift')).toEqual(['deadlift'])
    expect(find('pull down').sort()).toEqual(['lat_pull_down', 'lat_pulldown'])
    expect(find('pulldown').sort()).toEqual(['lat_pull_down', 'lat_pulldown'])
  })

  test('db, bb and kb stand for their weights, single means one, flye means fly', () => {
    expect(find('db curl')).toEqual(['dumbbell_curl'])
    expect(find('bb curl')).toEqual(['barbell_curl'])
    expect(find('kb swing')).toEqual(['kettlebell_swing'])
    expect(find('single arm row').sort()).toEqual(['one_arm_dumbbell_row', 'single_arm_cable_row'])
    expect(find('flye')).toEqual(['dumbbell_fly'])
    expect(find('flyes')).toEqual(['dumbbell_fly'])
  })

  test('an abbreviation of the whole name is an exact match', () => {
    const withMore: StoredExerciseCatalog = {
      ...formsCatalog,
      entries: [
        entry({
          key: 'dumbbell_curl_hold',
          name: 'Dumbbell Curl Hold',
          same_as: { bodybuild: 'dumbbell curl hold' },
        }),
        ...formsCatalog.entries,
      ],
    }
    expect(keys(searchExercises(withMore, { q: 'db curl' }))).toEqual(['dumbbell_curl', 'dumbbell_curl_hold'])
  })
})

describe('similar_to', () => {
  const similarCatalog: StoredExerciseCatalog = {
    ...catalog,
    entries: [
      entry({
        equipment: ['dumbbell'],
        key: 'standing_dumbbell_bicep_curl',
        name: 'Standing Dumbbell Bicep Curl',
      }),
      entry({ key: 'seated_dumbbell_bicep_curl', name: 'Seated Dumbbell Bicep Curl' }),
      entry({ key: 'hammer_curls', name: 'Hammer Curls', search_terms: ['dumbbell'] }),
      entry({ key: 'barbell_squat', name: 'Barbell Squat' }),
      entry({ key: 'tricep_extension', name: 'Tricep Extension' }),
      entry({ key: 'machine_triceps_extension', name: 'Machine Triceps Extension' }),
      entry({ key: 'low_cable_triceps_extension', name: 'Low Cable Triceps Extension' }),
      entry({
        key: 'dumbbell_one_arm_triceps_extension',
        name: 'Dumbbell One-Arm Triceps Extension',
      }),
    ],
  }
  const similar = (query: Parameters<typeof searchExercises>[1]) => searchExercises(similarCatalog, query)

  test('alone, gives the entries close to the name, closest first', () => {
    const result = similar({ similar_to: 'Dumbbell Bicep Curl' })
    expect(keys(result)).toEqual([
      'seated_dumbbell_bicep_curl',
      'standing_dumbbell_bicep_curl',
      'hammer_curls',
    ])
    expect(result.total).toBe(3)
  })

  test('alone, still applies the filters and pages', () => {
    expect(keys(similar({ equipment: 'dumbbell', similar_to: 'Dumbbell Bicep Curl' }))).toEqual([
      'standing_dumbbell_bicep_curl',
    ])
    const page = similar({ limit: 1, offset: 1, similar_to: 'Dumbbell Bicep Curl' })
    expect(keys(page)).toEqual(['standing_dumbbell_bicep_curl'])
    expect(page.total).toBe(3)
  })

  test('alone, a name with no relative gives nothing', () => {
    expect(similar({ similar_to: 'Zercher Carry' })).toMatchObject({ entries: [], total: 0 })
  })

  test('with q, orders equally ranked matches by closeness', () => {
    expect(keys(similar({ q: 'tricep extension' }))).toEqual([
      'tricep_extension',
      'machine_triceps_extension',
      'low_cable_triceps_extension',
      'dumbbell_one_arm_triceps_extension',
    ])
    expect(
      keys(similar({ q: 'tricep extension', similar_to: 'Single Arm Dumbbell Tricep Extension' })),
    ).toEqual([
      'tricep_extension',
      'dumbbell_one_arm_triceps_extension',
      'machine_triceps_extension',
      'low_cable_triceps_extension',
    ])
  })

  test('is ignored with name or fit', () => {
    expect(keys(search({ name: 'Bench Press', similar_to: 'Dumbbell Bench Press' }))).toEqual(['bench_press'])
    expect(
      keys(search({ fit: 'bench_press/weighted_bench_press', similar_to: 'Dumbbell Bench Press' })),
    ).toEqual(['bench_press'])
  })

  test('suggestions read single as one', () => {
    expect(suggestExercises(similarCatalog, 'Single Arm Dumbbell Tricep Extension')[0]?.key).toBe(
      'dumbbell_one_arm_triceps_extension',
    )
  })
})

describe('suggestExercises', () => {
  const suggestionCatalog: StoredExerciseCatalog = {
    ...catalog,
    entries: [
      entry({ key: 'standing_dumbbell_bicep_curl', name: 'Standing Dumbbell Bicep Curl' }),
      entry({ key: 'seated_dumbbell_bicep_curl', name: 'Seated Dumbbell Bicep Curl' }),
      entry({ key: 'hammer_curls', name: 'Hammer Curls', search_terms: ['dumbbell'] }),
      entry({ aliases: ['Bench Press'], key: 'barbell_bench_press', name: 'Barbell Bench Press' }),
      entry({ key: 'dumbbell_bench_press', name: 'Dumbbell Bench Press' }),
      entry({ key: 'wide_grip_lat_pulldown', name: 'Wide-Grip Lat Pulldown' }),
      entry({ key: 'lat_pulldown', name: 'Lat Pulldown' }),
      entry({ key: 'close_grip_lat_pulldown', name: 'Close-Grip Lat Pulldown' }),
      entry({ key: 'barbell_squat', name: 'Barbell Squat' }),
    ],
  }
  const suggest = (name: string, limit?: number) =>
    suggestExercises(suggestionCatalog, name, limit).map((e) => e.key)

  test('ranks by word overlap with the best name or alias, ties by shorter name', () => {
    expect(suggest('Dumbbell Bicep Curl')).toEqual([
      'seated_dumbbell_bicep_curl',
      'standing_dumbbell_bicep_curl',
      'hammer_curls',
    ])
  })

  test('a short name meets an alias it is part of', () => {
    expect(suggest('Bench')).toEqual(['barbell_bench_press'])
  })

  test('word order and punctuation do not matter', () => {
    expect(suggest('Lat Pulldown (Wide Grip)')).toEqual([
      'wide_grip_lat_pulldown',
      'close_grip_lat_pulldown',
      'lat_pulldown',
    ])
  })

  test('a word meets its plural, and words only in search terms count half', () => {
    expect(suggest('Dumbbell Hammer Curl', 1)).toEqual(['hammer_curls'])
  })

  test('a name with no relative gets no suggestions', () => {
    expect(suggest('Zercher Carry')).toEqual([])
    expect(suggest('  ')).toEqual([])
  })

  test('suggests from the built-in catalogue', () => {
    expect(suggestExercises(loadExerciseCatalog(), 'Lat Pulldown (Wide Grip)')[0]?.name).toBe(
      'Wide-Grip Lat Pulldown',
    )
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

  test('a common lift leads with its canonical free-weight entry', () => {
    const builtIn = loadExerciseCatalog()
    const names = (q: string) => searchExercises(builtIn, { limit: 3, q }).entries.map((e) => e.name)
    expect(names('squat')).toEqual(['Barbell Squat', 'Dumbbell Squat', 'Squat'])
    expect(names('bench press')).toEqual(['Barbell Bench Press', 'Dumbbell Bench Press', 'Bench Press'])
    expect(names('deadlift')).toEqual(['Deadlift', 'Dumbbell Deadlift', 'Kettlebell Deadlift'])
  })

  test('a logged name keeps its closest entry near the top of a search', () => {
    const names = searchExercises(loadExerciseCatalog(), {
      limit: 3,
      q: 'tricep extension',
      similar_to: 'Single Arm Dumbbell Tricep Extension',
    }).entries.map((e) => e.name)
    expect(names.slice(0, 2)).toContain('Dumbbell One-Arm Triceps Extension')
  })

  test.each(['hip thrusts', 'lateral raises', 'situp'])('finds %s', (q) => {
    expect(searchExercises(loadExerciseCatalog(), { q }).total).toBeGreaterThan(0)
  })

  test('finds entries by Garmin FIT key', () => {
    const builtIn = loadExerciseCatalog()
    expect(findExerciseByFit(builtIn, 'deadlift/barbell_deadlift')?.key).toBe('deadlift')
    expect(findExerciseByFit(builtIn, 'push_up/weighted_push_up')?.key).toBe('push_up')
    expect(findExerciseByFit(builtIn, 'sled/pull')?.name).toBe('Sled Pull')
  })
})
