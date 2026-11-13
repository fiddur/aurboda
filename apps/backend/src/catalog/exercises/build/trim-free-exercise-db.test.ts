import { describe, expect, test } from 'vitest'

import { type RawFreeExercise, trimExercise, trimFreeExerciseDb } from './trim-free-exercise-db.ts'

const raw = (overrides: Partial<RawFreeExercise>): RawFreeExercise => ({
  category: 'strength',
  equipment: 'barbell',
  id: 'Some_Exercise',
  name: 'Some Exercise',
  primaryMuscles: ['chest'],
  secondaryMuscles: [],
  ...overrides,
})

describe('trimExercise', () => {
  test('maps muscles to group keys, primary 1 and secondary 0.5', () => {
    expect(
      trimExercise(raw({ primaryMuscles: ['lower back'], secondaryMuscles: ['middle back', 'hamstrings'] })),
    ).toMatchObject({ muscles: { hamstrings: 0.5, lower_back: 1, middle_back: 0.5 } })
  })

  test('a muscle listed as both primary and secondary keeps weight 1', () => {
    expect(trimExercise(raw({ primaryMuscles: ['chest'], secondaryMuscles: ['chest'] }))?.muscles).toEqual({
      chest: 1,
    })
  })

  test.each([
    ['kettlebells', ['kettlebell']],
    ['e-z curl bar', ['ez_bar']],
    ['medicine ball', ['medicine_ball']],
    ['body only', []],
    [null, []],
  ])('maps equipment %s', (equipment, expected) => {
    expect(trimExercise(raw({ equipment }))?.equipment).toEqual(expected)
  })

  test.each([
    ['strongman', 'strength'],
    ['powerlifting', 'strength'],
    ['olympic weightlifting', 'strength'],
    ['stretching', 'stretching'],
    ['plyometrics', 'plyometrics'],
  ])('maps category %s', (category, expected) => {
    expect(trimExercise(raw({ category }))?.category).toBe(expected)
  })

  test('drops cardio', () => {
    expect(trimExercise(raw({ category: 'cardio' }))).toBeUndefined()
  })

  test('an unknown vocabulary value is a hard error', () => {
    expect(() => trimExercise(raw({ equipment: 'spaceship' }))).toThrow("Unknown equipment 'spaceship'")
  })

  test('keeps only id, name, category, equipment and muscles', () => {
    const trimmed = trimFreeExerciseDb([
      { ...raw({}), instructions: ['x'], level: 'beginner' } as RawFreeExercise,
      raw({ category: 'cardio', id: 'Run' }),
    ])
    expect(trimmed.entries).toEqual([
      {
        category: 'strength',
        equipment: ['barbell'],
        id: 'Some_Exercise',
        muscles: { chest: 1 },
        name: 'Some Exercise',
      },
    ])
  })
})
