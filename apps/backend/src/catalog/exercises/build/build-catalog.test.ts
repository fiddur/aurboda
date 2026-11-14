import { storedExerciseCatalogEntrySchema, storedExerciseCatalogSchema } from '@aurboda/api-spec'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import type { BodybuildSourceFile } from './convert-bodybuild.ts'
import type { FreeExerciseSourceFile } from './trim-free-exercise-db.ts'
import type { GarminSourceFile } from './trim-garmin.ts'

import { normalizeExerciseName } from '../../../services/exercise-catalog.ts'
import {
  bodybuildDisplayName,
  buildCatalog,
  buildCatalogFromFiles,
  CATALOG_FILE,
  type CatalogLinks,
  deriveKey,
  type GarminLinks,
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

const garminSource = (entries: GarminSourceFile['entries'] = []) =>
  ({ entries, source: { fetched: 'f', names_url: 'n', url: 'u' } }) as unknown as GarminSourceFile
const garminLinks = (overrides: Partial<GarminLinks> = {}): GarminLinks => ({
  entries: {},
  links: {},
  name_overrides: {},
  variants: {},
  ...overrides,
})

const build = (
  bb: BodybuildSourceFile,
  fe: FreeExerciseSourceFile,
  catalogLinks: CatalogLinks,
  garmin: GarminSourceFile = garminSource(),
  curated: GarminLinks = garminLinks(),
) => buildCatalog(bb, fe, catalogLinks, garmin, curated)

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
    ['Plié Squat', 'plie_squat'],
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
    const catalog = build(
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
    const [entry] = build(
      bodybuild([{ ...bbBench, equipment: [], muscles: {} }]),
      free([feBench]),
      links({ links: { 'dumbbell bench press': 'Dumbbell_Bench_Press_Flat' } }),
    ).entries
    expect(entry).toMatchObject({ equipment: ['dumbbell'], muscles: { chest: 1, triceps: 0.5 } })
  })

  test('the free-exercise-db name is no alias when it normalises to the name', () => {
    const [entry] = build(
      bodybuild([bbBench]),
      free([{ ...feBench, name: 'Dumbbell Bench-Press' }]),
      links({ links: { 'dumbbell bench press': 'Dumbbell_Bench_Press_Flat' } }),
    ).entries
    expect(entry?.aliases).toEqual([])
  })

  test('a normalised name collision fails with both names', () => {
    expect(() =>
      build(bodybuild([bbBench]), free([{ ...feBench, name: 'Dumbbell Bench-Press!' }]), links()),
    ).toThrow(/Dumbbell Bench-Press!.*Dumbbell Bench Press|Dumbbell Bench Press.*Dumbbell Bench-Press!/s)
  })

  test('a name override by source reference resolves a collision and derives the key', () => {
    const catalog = build(
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
    const [entry] = build(
      bodybuild([bbBench]),
      free([]),
      links({ aliases: { dumbbell_bench_press: ['DB Press'] }, wikidata: { dumbbell_bench_press: 'Q1' } }),
    ).entries
    expect(entry).toMatchObject({ aliases: ['DB Press'], same_as: { wikidata: 'Q1' } })
    expect(() => build(bodybuild([bbBench]), free([]), links({ wikidata: { nope: 'Q1' } }))).toThrow(
      'wikidata.nope',
    )
  })

  test('an equipment override replaces the built equipment, including with none', () => {
    const linked = links({
      equipment: { dumbbell_bench_press: ['dumbbell', 'plate'] },
      links: { 'dumbbell bench press': 'Dumbbell_Bench_Press_Flat' },
    })
    expect(build(bodybuild([bbBench]), free([feBench]), linked).entries[0]?.equipment).toEqual([
      'dumbbell',
      'plate',
    ])
    const cleared = links({ equipment: { dumbbell_bench_press: [] } })
    expect(build(bodybuild([bbBench]), free([]), cleared).entries[0]?.equipment).toEqual([])
  })

  test('an equipment override for an unknown key or with unknown equipment fails', () => {
    expect(() => build(bodybuild([bbBench]), free([]), links({ equipment: { nope: ['dumbbell'] } }))).toThrow(
      'equipment.nope',
    )
    expect(() =>
      build(
        bodybuild([bbBench]),
        free([]),
        links({ equipment: { dumbbell_bench_press: ['dumbbell', 'spaceship'] } }),
      ),
    ).toThrow('equipment.dumbbell_bench_press has unknown equipment spaceship')
  })

  test('a link to an unknown id fails', () => {
    expect(() =>
      build(bodybuild([bbBench]), free([]), links({ links: { 'dumbbell bench press': 'Missing' } })),
    ).toThrow("unknown free-exercise-db id 'Missing'")
  })

  test('entries are sorted by key and the output is deterministic', () => {
    const args = [
      bodybuild([bbBench]),
      free([{ ...feBench, id: 'A', name: 'Arnold Press' }]),
      links(),
    ] as const
    const first = build(...args)
    expect(first.entries.map((e) => e.key)).toEqual(['arnold_press', 'dumbbell_bench_press'])
    expect(JSON.stringify(build(...args))).toBe(JSON.stringify(first))
  })
})

describe('buildCatalog with Garmin exercises', () => {
  const garmin = garminSource([
    { fit: 'bench_press/dumbbell_bench_press', name: 'Dumbbell Bench Press' },
    { fit: 'bench_press/flat_dumbbell_press', name: 'Flat Dumbbell Press' },
    { fit: 'bench_press/db_press', name: 'DB Press!' },
    { fit: 'bench_press/weighted_db_press', name: 'Weighted DB Press' },
    { fit: 'plank/plank', name: 'Plank' },
    { fit: 'plank/weighted_plank', name: 'Weighted Plank' },
  ])
  const plank = { category: 'strength' as const, equipment: [], muscles: { obliques: 0.5, abdominals: 1 } }
  const curated = (overrides: Partial<GarminLinks> = {}) =>
    garminLinks({
      entries: { 'plank/plank': plank },
      links: {
        'bench_press/db_press': 'dumbbell_bench_press',
        'bench_press/dumbbell_bench_press': 'dumbbell_bench_press',
        'bench_press/flat_dumbbell_press': 'dumbbell_bench_press',
      },
      variants: {
        'bench_press/weighted_db_press': 'bench_press/db_press',
        'plank/weighted_plank': 'plank/plank',
      },
      ...overrides,
    })
  const catalogLinks = links({ aliases: { dumbbell_bench_press: ['DB Press'] } })
  const catalog = () => build(bodybuild([bbBench]), free([]), catalogLinks, garmin, curated())
  const entry = (key: string) => catalog().entries.find((e) => e.key === key)

  test('linked exercises put their sorted FIT keys and variants on the entry', () => {
    expect(entry('dumbbell_bench_press')?.same_as).toEqual({
      bodybuild: 'dumbbell bench press',
      fit: [
        'bench_press/db_press',
        'bench_press/dumbbell_bench_press',
        'bench_press/flat_dumbbell_press',
        'bench_press/weighted_db_press',
      ],
    })
  })

  test('a linked Garmin name is an alias unless it normalises to the name or an existing alias', () => {
    expect(entry('dumbbell_bench_press')?.aliases).toEqual(['DB Press', 'Flat Dumbbell Press'])
  })

  test('a Garmin-only entry takes its name, key, curated muscles (sorted) and category; its variant shares it', () => {
    expect(entry('plank')).toEqual({
      key: 'plank',
      name: 'Plank',
      aliases: [],
      search_terms: [],
      category: 'strength',
      equipment: [],
      muscles: { abdominals: 1, obliques: 0.5 },
      same_as: { fit: ['plank/plank', 'plank/weighted_plank'] },
    })
  })

  test('a name override renames a Garmin-only entry; curated aliases, equipment and wikidata reach it', () => {
    const renamed = build(
      bodybuild([bbBench]),
      free([]),
      links({
        aliases: { forearm_plank: ['Elbow Plank'] },
        equipment: { forearm_plank: ['other'] },
        wikidata: { forearm_plank: 'Q2' },
      }),
      garmin,
      curated({ name_overrides: { 'plank/plank': 'Forearm Plank' } }),
    ).entries.find((e) => e.key === 'forearm_plank')
    expect(renamed).toMatchObject({
      aliases: ['Elbow Plank'],
      equipment: ['other'],
      name: 'Forearm Plank',
      same_as: { fit: ['plank/plank', 'plank/weighted_plank'], wikidata: 'Q2' },
    })
  })

  test('the Garmin source is listed', () => {
    expect(catalog().sources.garmin_connect).toEqual({ fetched: 'f', names_url: 'n', url: 'u' })
  })

  const fails = (overrides: Partial<GarminLinks>, message: string) =>
    expect(() => build(bodybuild([bbBench]), free([]), catalogLinks, garmin, curated(overrides))).toThrow(
      message,
    )

  test('a source FIT key in no section fails', () => {
    fails(
      { variants: { 'plank/weighted_plank': 'plank/plank' } },
      'bench_press/weighted_db_press is in none of',
    )
  })

  test('a FIT key in two sections fails', () => {
    fails(
      { entries: { 'plank/plank': plank, 'plank/weighted_plank': plank } },
      'plank/weighted_plank is in more than one of variants, entries',
    )
  })

  test('a FIT key not in the source fails', () => {
    fails(
      { entries: { 'plank/plank': plank, 'plank/side': plank } },
      'entries.plank/side is not a source FIT key',
    )
  })

  test('a name override for a FIT key that is not a Garmin-only entry fails', () => {
    fails(
      { name_overrides: { 'bench_press/db_press': 'X' } },
      'name_overrides.bench_press/db_press is not a Garmin-only entry',
    )
  })

  test('a link to an unknown entry fails', () => {
    fails(
      {
        links: {
          'bench_press/db_press': 'nope',
          'bench_press/dumbbell_bench_press': 'dumbbell_bench_press',
          'bench_press/flat_dumbbell_press': 'dumbbell_bench_press',
        },
      },
      "links.bench_press/db_press names unknown entry 'nope'",
    )
  })

  test('a variant of a variant fails', () => {
    fails(
      {
        variants: {
          'bench_press/weighted_db_press': 'plank/weighted_plank',
          'plank/weighted_plank': 'plank/plank',
        },
      },
      "variants.bench_press/weighted_db_press has base 'plank/weighted_plank'",
    )
  })

  test.each([
    [{ ...plank, category: 'cardio' }, "unknown category 'cardio'"],
    [{ ...plank, equipment: ['spaceship'] }, "unknown equipment 'spaceship'"],
    [{ ...plank, muscles: { wings: 1 } }, "unknown muscle 'wings'"],
    [{ ...plank, muscles: { abdominals: 0 } }, "weight 0 for 'abdominals'"],
    [{ ...plank, muscles: { abdominals: 1.5 } }, "weight 1.5 for 'abdominals'"],
  ])('an invalid Garmin-only entry fails: %j', (invalid, message) => {
    fails(
      { entries: { 'plank/plank': invalid as GarminLinks['entries'][string] } },
      `entries.plank/plank has ${message}`,
    )
  })

  test('every offender is named', () => {
    expect(() => build(bodybuild([bbBench]), free([]), catalogLinks, garmin, garminLinks())).toThrow(
      /plank\/plank is in none[\s\S]*plank\/weighted_plank is in none/,
    )
  })
})

describe('the committed catalogue', () => {
  const committed = readFileSync(CATALOG_FILE, 'utf8')
  const catalog = storedExerciseCatalogSchema.parse(JSON.parse(committed))
  const freeSource = JSON.parse(
    readFileSync(new URL('../sources/free-exercise-db.json', import.meta.url), 'utf8'),
  ) as FreeExerciseSourceFile
  const garminFile = JSON.parse(
    readFileSync(new URL('../sources/garmin.json', import.meta.url), 'utf8'),
  ) as GarminSourceFile
  const curatedGarmin = JSON.parse(
    readFileSync(new URL('../garmin-links.json', import.meta.url), 'utf8'),
  ) as GarminLinks

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

  test('carries every Garmin FIT key on exactly one entry, and no other', () => {
    const fits = catalog.entries.flatMap((e) => e.same_as.fit ?? [])
    expect(fits.toSorted()).toEqual(garminFile.entries.map((e) => e.fit))
  })

  test('the entries from neither body.build nor free-exercise-db are the Garmin-only entries', () => {
    const garminOnly = catalog.entries.filter(
      (e) => e.same_as.bodybuild === undefined && e.same_as.free_exercise_db === undefined,
    )
    expect(
      garminOnly
        .flatMap((e) => e.same_as.fit?.filter((fit) => fit in curatedGarmin.entries) ?? [])
        .toSorted(),
    ).toEqual(Object.keys(curatedGarmin.entries).toSorted())
    expect(garminOnly).toHaveLength(Object.keys(curatedGarmin.entries).length)
  })
})
