import type { DataSchemaDefinition, ExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { itemFieldCatalog, muscleTiers } from './catalogEntryView'

const muscle = (name: string, weight: number) => ({
  group: 'chest' as const,
  key: 'chest' as const,
  name,
  weight,
})

const entry: ExerciseCatalogEntry = {
  aliases: [],
  category: 'strength',
  equipment: [],
  key: 'barbell_bench_press',
  muscles: [
    muscle('Lower pecs', 1),
    muscle('Front delts', 0.75),
    muscle('Triceps', 0.5),
    muscle('Upper pecs', 0.25),
  ],
  name: 'Barbell Bench Press',
  same_as: {},
}

describe('muscleTiers', () => {
  it('splits at a weight of 0.75, keeping the entry order', () => {
    expect(muscleTiers(entry)).toEqual({
      primary: ['Lower pecs', 'Front delts'],
      secondary: ['Triceps', 'Upper pecs'],
    })
  })

  it('returns empty tiers for an entry without muscles', () => {
    expect(muscleTiers({ ...entry, muscles: [] })).toEqual({ primary: [], secondary: [] })
  })
})

describe('itemFieldCatalog', () => {
  const schema: DataSchemaDefinition = {
    fields: [
      { name: 'title', type: 'string' },
      {
        item_fields: [
          { catalog: 'exercises', is_categorical: true, name: 'exercise', type: 'string' },
          { name: 'reps', type: 'number' },
        ],
        name: 'sets',
        type: 'list',
      },
    ],
  }

  it('returns the catalogue of the item field the path names', () => {
    expect(itemFieldCatalog(schema, 'sets.exercise')).toBe('exercises')
  })

  it('is undefined for an item field without a catalogue, an unknown path or no schema', () => {
    expect(itemFieldCatalog(schema, 'sets.reps')).toBeUndefined()
    expect(itemFieldCatalog(schema, 'sets.missing')).toBeUndefined()
    expect(itemFieldCatalog(schema, 'title')).toBeUndefined()
    expect(itemFieldCatalog(undefined, 'sets.exercise')).toBeUndefined()
  })
})
