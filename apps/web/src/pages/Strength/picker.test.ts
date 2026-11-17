import {
  type ActivityFieldValue,
  type ExerciseCatalogEntry,
  exerciseMuscleGroups,
  type MuscleRecovery,
} from '@aurboda/api-spec'
import { describe, expect, it } from 'vitest'

import { buildPickerSections, muscleFilterLabel, muscleFilterOptions, recentExercises } from './picker'

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

describe('muscle filter with recovery', () => {
  const recovery: MuscleRecovery = {
    at: '2026-11-17T12:00:00.000Z',
    field: 'sets.exercise',
    groups: [
      {
        fatigue: 0.36,
        half_life_hours: 24,
        muscle_group: 'chest',
        name: 'Chest',
        ready_at: '2026-11-18T02:00:00.000Z',
        recovery: 64,
        sources: [],
      },
      {
        fatigue: 0,
        half_life_hours: 36,
        muscle_group: 'quadriceps',
        name: 'Quadriceps',
        ready_at: null,
        recovery: 100,
        sources: [],
      },
    ],
    ready_percent: 80,
    window_days: 10,
  }

  it('keeps the options and their order, adding recovery below 100', () => {
    const options = muscleFilterOptions(recovery)
    expect(options.map((o) => o.value)).toEqual([...exerciseMuscleGroups])
    expect(options.find((o) => o.value === 'chest')?.label).toBe('Chest · 64 %')
    expect(options.find((o) => o.value === 'quadriceps')?.label).toBe('Quadriceps')
  })

  it('gives the plain names without recovery', () => {
    expect(muscleFilterOptions(undefined).find((o) => o.value === 'chest')?.label).toBe('Chest')
  })

  it('labels the chosen filter the same way', () => {
    expect(muscleFilterLabel('chest', recovery)).toBe('Chest · 64 %')
    expect(muscleFilterLabel('chest', null)).toBe('Chest')
  })
})
