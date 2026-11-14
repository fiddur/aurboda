import { storedExerciseCatalogEntrySchema, storedExerciseCatalogSchema } from '@aurboda/api-spec'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import type { BodybuildSourceFile } from './convert-bodybuild.ts'
import type { FreeExerciseSourceFile } from './trim-free-exercise-db.ts'

import { normalizeExerciseName } from '../../../services/exercise-catalog.ts'
import {
  bodybuildDisplayName,
  buildCatalog,
  buildCatalogFromFiles,
  CATALOG_FILE,
  type CatalogLinks,
  deriveKey,
} from './build-catalog.ts'

const source = { commit: 'c', license: 'l', url: 'u' }

const bodybuild = (entries: BodybuildSourceFile['entries']) =>
  ({ entries, source }) as unknown as BodybuildSourceFile
const free = (entries: FreeExerciseSourceFile['entries']) =>
  ({ entries, source }) as unknown as FreeExerciseSourceFile
const links = (overrides: Partial<CatalogLinks> = {}): CatalogLinks => ({
  aliases: {},
  equipment: {},
  links: {},
  name_overrides: {},
  version: '2026.11.0',
  wikidata: {},
  ...overrides,
})

const bbBench = {
  equipment: ['dumbbell' as const],
  id: 'dumbbell bench press',
  muscles: { front_delts: 1, lower_pecs: 1 },
  search_aliases: ['DB'],
}
const feBench = {
  category: 'strength' as const,
  equipment: ['dumbbell' as const],
  id: 'Dumbbell_Bench_Press_Flat',
  muscles: { chest: 1, triceps: 0.5 },
  name: 'Dumbbell Bench Press (Flat)',
}

describe('deriveKey', () => {
  test.each([
    ['Dumbbell Bench Press', 'dumbbell_bench_press'],
    ['45° Back Extension', 'back_extension_45'],
    ['3/4 Sit-Up', 'sit_up_3_4'],
    ['Rock & Roll', 'rock_and_roll'],
    ["Farmer's Walk", 'farmer_s_walk'],
    ['Barbell Bench Press - Medium Grip', 'barbell_bench_press_medium_grip'],
  ])('%s -> %s', (name, key) => {
    expect(deriveKey(name)).toBe(key)
  })
})

describe('bodybuildDisplayName', () => {
  test.each([
    ['standing ez bar bicep curl', 'Standing EZ Bar Bicep Curl'],
    ['ez-bar preacher bicep curl bench', 'EZ-Bar Preacher Bicep Curl Bench'],
    ['TRX face pull', 'TRX Face Pull'],
    ['bodyweight leg curl with trx', 'Bodyweight Leg Curl with TRX'],
    ['pec deck (elbow pad)', 'Pec Deck (Elbow Pad)'],
    ['smitch machine inverted skull crusher', 'Smith Machine Inverted Skull Crusher'],
    ['45° back extension', '45° Back Extension'],
  ])('%s -> %s', (id, name) => {
    expect(bodybuildDisplayName(id)).toBe(name)
  })
})

describe('buildCatalog', () => {
  test('a linked pair merges: body.build name, muscles and equipment; the other name an alias', () => {
    const catalog = buildCatalog(
      bodybuild([bbBench]),
      free([feBench]),
      links({ links: { 'dumbbell bench press': 'Dumbbell_Bench_Press_Flat' } }),
    )
    expect(catalog.entries).toEqual([
      {
        key: 'dumbbell_bench_press',
        name: 'Dumbbell Bench Press',
        aliases: ['Dumbbell Bench Press (Flat)'],
        search_terms: ['DB'],
        category: 'strength',
        equipment: ['dumbbell'],
        muscles: { front_delts: 1, lower_pecs: 1 },
        same_as: { bodybuild: 'dumbbell bench press', free_exercise_db: 'Dumbbell_Bench_Press_Flat' },
      },
    ])
  })

  test('a linked pair falls back to free-exercise-db equipment and muscles when body.build has none', () => {
    const [entry] = buildCatalog(
      bodybuild([{ ...bbBench, equipment: [], muscles: {} }]),
      free([feBench]),
      links({ links: { 'dumbbell bench press': 'Dumbbell_Bench_Press_Flat' } }),
    ).entries
    expect(entry).toMatchObject({ equipment: ['dumbbell'], muscles: { chest: 1, triceps: 0.5 } })
  })

  test('the free-exercise-db name is no alias when it normalises to the name', () => {
    const [entry] = buildCatalog(
      bodybuild([bbBench]),
      free([{ ...feBench, name: 'Dumbbell Bench-Press' }]),
      links({ links: { 'dumbbell bench press': 'Dumbbell_Bench_Press_Flat' } }),
    ).entries
    expect(entry?.aliases).toEqual([])
  })

  test('a normalised name collision fails with both names', () => {
    expect(() =>
      buildCatalog(bodybuild([bbBench]), free([{ ...feBench, name: 'Dumbbell Bench-Press!' }]), links()),
    ).toThrow(/Dumbbell Bench-Press!.*Dumbbell Bench Press|Dumbbell Bench Press.*Dumbbell Bench-Press!/s)
  })

  test('a name override by source reference resolves a collision and derives the key', () => {
    const catalog = buildCatalog(
      bodybuild([bbBench]),
      free([{ ...feBench, name: 'Dumbbell Bench Press' }]),
      links({ name_overrides: { 'free_exercise_db:Dumbbell_Bench_Press_Flat': 'Flat Dumbbell Press' } }),
    )
    expect(catalog.entries.map((e) => [e.key, e.name])).toEqual([
      ['dumbbell_bench_press', 'Dumbbell Bench Press'],
      ['flat_dumbbell_press', 'Flat Dumbbell Press'],
    ])
  })

  test('curated aliases and wikidata ids land on their key; unknown keys fail', () => {
    const [entry] = buildCatalog(
      bodybuild([bbBench]),
      free([]),
      links({ aliases: { dumbbell_bench_press: ['DB Press'] }, wikidata: { dumbbell_bench_press: 'Q1' } }),
    ).entries
    expect(entry).toMatchObject({ aliases: ['DB Press'], same_as: { wikidata: 'Q1' } })
    expect(() => buildCatalog(bodybuild([bbBench]), free([]), links({ wikidata: { nope: 'Q1' } }))).toThrow(
      'wikidata.nope',
    )
  })

  test('an equipment override replaces the built equipment, including with none', () => {
    const linked = links({
      equipment: { dumbbell_bench_press: ['dumbbell', 'plate'] },
      links: { 'dumbbell bench press': 'Dumbbell_Bench_Press_Flat' },
    })
    expect(buildCatalog(bodybuild([bbBench]), free([feBench]), linked).entries[0]?.equipment).toEqual([
      'dumbbell',
      'plate',
    ])
    const cleared = links({ equipment: { dumbbell_bench_press: [] } })
    expect(buildCatalog(bodybuild([bbBench]), free([]), cleared).entries[0]?.equipment).toEqual([])
  })

  test('an equipment override for an unknown key or with unknown equipment fails', () => {
    expect(() =>
      buildCatalog(bodybuild([bbBench]), free([]), links({ equipment: { nope: ['dumbbell'] } })),
    ).toThrow('equipment.nope')
    expect(() =>
      buildCatalog(
        bodybuild([bbBench]),
        free([]),
        links({ equipment: { dumbbell_bench_press: ['dumbbell', 'spaceship'] } }),
      ),
    ).toThrow('equipment.dumbbell_bench_press has unknown equipment spaceship')
  })

  test('a link to an unknown id fails', () => {
    expect(() =>
      buildCatalog(bodybuild([bbBench]), free([]), links({ links: { 'dumbbell bench press': 'Missing' } })),
    ).toThrow("unknown free-exercise-db id 'Missing'")
  })

  test('entries are sorted by key and the output is deterministic', () => {
    const args = [
      bodybuild([bbBench]),
      free([{ ...feBench, id: 'A', name: 'Arnold Press' }]),
      links(),
    ] as const
    const first = buildCatalog(...args)
    expect(first.entries.map((e) => e.key)).toEqual(['arnold_press', 'dumbbell_bench_press'])
    expect(JSON.stringify(buildCatalog(...args))).toBe(JSON.stringify(first))
  })
})

describe('the committed catalogue', () => {
  const committed = readFileSync(CATALOG_FILE, 'utf8')
  const catalog = storedExerciseCatalogSchema.parse(JSON.parse(committed))
  const freeSource = JSON.parse(
    readFileSync(new URL('../sources/free-exercise-db.json', import.meta.url), 'utf8'),
  ) as FreeExerciseSourceFile

  test('is exactly what the committed sources and links build', () => {
    expect(buildCatalogFromFiles()).toBe(committed)
  })

  test('every entry parses with the stored-entry schema', () => {
    for (const entry of catalog.entries) expect(storedExerciseCatalogEntrySchema.parse(entry)).toEqual(entry)
  })

  test('keys are unique, and names and aliases are unique after normalisation', () => {
    expect(new Set(catalog.entries.map((e) => e.key)).size).toBe(catalog.entries.length)
    const labels = catalog.entries.flatMap((e) => [e.name, ...e.aliases]).map(normalizeExerciseName)
    expect(new Set(labels).size).toBe(labels.length)
  })

  test('carries every body.build strength exercise', () => {
    expect(catalog.entries.filter((e) => e.same_as.bodybuild !== undefined)).toHaveLength(157)
  })

  test('carries every non-cardio free-exercise-db exercise exactly once', () => {
    const ids = catalog.entries.flatMap((e) => e.same_as.free_exercise_db ?? [])
    expect(ids.toSorted()).toEqual(freeSource.entries.map((e) => e.id).toSorted())
  })
})
