import type { ActivityFieldValue, ExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { buildPickerSections, recentExercises } from './picker'

const own: ActivityFieldValue[] = [
  {
    catalog_key: 'barbell_bench_press',
    count: 41,
    last_used: '2026-11-10T17:00:00.000Z',
    value: 'Bench press',
  },
  { count: 12, last_used: '2026-11-08T17:00:00.000Z', value: 'Pull-up' },
  { count: 3, last_used: '2026-10-01T17:00:00.000Z', value: 'Goblet squat' },
]

const entry = (key: string, name: string): ExerciseCatalogEntry => ({
  aliases: [],
  category: 'strength',
  equipment: [],
  key,
  muscles: [{ group: 'quadriceps', key: 'quadriceps', name: 'Quadriceps', weight: 1 }],
  name,
  same_as: {},
})

describe('recentExercises', () => {
  it('lists the exercises of the last three sessions in order, once each', () => {
    expect(
      recentExercises([
        [{ exercise: 'Bench press' }, { exercise: 'Pull-up' }],
        [{ exercise: 'bench press' }, { exercise: 'Squat' }],
        [{ exercise: 'Row' }],
        [{ exercise: 'Curl' }],
      ]),
    ).toEqual(['Bench press', 'Pull-up', 'Squat', 'Row'])
  })
})

describe('buildPickerSections', () => {
  it('shows recent then the rest of the own names when nothing is typed', () => {
    const sections = buildPickerSections({ catalog: [], own, recent: ['Pull-up', 'Squat'], text: '' })
    expect(sections.map((s) => [s.title, s.items.map((i) => i.value)])).toEqual([
      ['Recent', ['Pull-up', 'Squat']],
      ['Your exercises', ['Bench press', 'Goblet squat']],
    ])
    expect(sections[0].items[0]).toEqual({
      count: 12,
      kind: 'own',
      last_used: '2026-11-08T17:00:00.000Z',
      value: 'Pull-up',
    })
    expect(sections[0].items[1]).toEqual({ kind: 'own', value: 'Squat' })
  })

  it('lists filtered catalogue entries when nothing is typed', () => {
    const sections = buildPickerSections({
      catalog: [entry('barbell_squat', 'Barbell squat')],
      own: [],
      recent: [],
      text: '',
    })
    expect(sections).toEqual([
      {
        items: [{ hint: 'Quadriceps', key: 'barbell_squat', kind: 'catalog', value: 'Barbell squat' }],
        title: 'From the catalogue',
      },
    ])
  })

  it('puts matching own names first, then catalogue entries not already listed, then the new-name row', () => {
    const sections = buildPickerSections({
      catalog: [
        entry('barbell_bench_press', 'Barbell bench press'),
        entry('dumbbell_bench_press', 'Dumbbell bench press'),
        entry('bench_press', 'bench press'),
      ],
      own,
      recent: [],
      text: ' bench ',
    })
    expect(sections.map((s) => [s.title, s.items.map((i) => `${i.kind}:${i.value}`)])).toEqual([
      ['Your exercises', ['own:Bench press']],
      ['From the catalogue', ['catalog:Dumbbell bench press']],
      [undefined, ['new:bench']],
    ])
  })

  it('leaves out the new-name row when the text is a listed name', () => {
    const sections = buildPickerSections({ catalog: [], own, recent: [], text: 'pull-up' })
    expect(sections.flatMap((s) => s.items.map((i) => i.kind))).toEqual(['own'])
    const fromCatalog = buildPickerSections({
      catalog: [entry('barbell_squat', 'Barbell squat')],
      own: [],
      recent: [],
      text: 'barbell squat',
    })
    expect(fromCatalog.flatMap((s) => s.items.map((i) => i.kind))).toEqual(['catalog'])
  })

  it('offers only the new-name row when nothing matches', () => {
    expect(buildPickerSections({ catalog: [], own, recent: [], text: 'squat jump' })).toEqual([
      { items: [{ kind: 'new', value: 'squat jump' }] },
    ])
  })
})
