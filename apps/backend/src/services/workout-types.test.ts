import { describe, expect, test } from 'vitest'

import { type WorkoutTypeDefinition, workoutTypeNames } from './workout-types.ts'

const def = (name: string, display_category: string, parent_type?: string | null): WorkoutTypeDefinition => ({
  display_category,
  name,
  parent_type,
})

describe('workoutTypeNames', () => {
  test('includes a built-in subtype of exercise', () => {
    expect(workoutTypeNames([def('exercise', 'exercise'), def('running', 'exercise', 'exercise')])).toEqual(
      expect.arrayContaining(['exercise', 'running']),
    )
  })

  test('includes a custom type in the exercise category without a parent', () => {
    expect(workoutTypeNames([def('yard_work', 'exercise')])).toContain('yard_work')
  })

  test('includes a custom child of a workout type whatever its own category', () => {
    const names = workoutTypeNames([
      def('running', 'exercise', 'exercise'),
      def('trail_running', 'other', 'running'),
    ])
    expect(names).toContain('trail_running')
  })

  test('excludes meditation, sleep and wellness types', () => {
    const names = workoutTypeNames([
      def('meditation', 'mindfulness'),
      def('sleep', 'sleep'),
      def('sauna', 'wellness'),
      def('breathwork', 'wellness'),
    ])
    expect(names).toEqual(['exercise'])
  })

  test('counts a Health Connect exercise subtype by name even without parent or exercise category', () => {
    expect(workoutTypeNames([def('yoga', 'other')])).toContain('yoga')
  })

  test('gives just exercise without definitions', () => {
    expect(workoutTypeNames([])).toEqual(['exercise'])
  })

  test('has no duplicates', () => {
    const names = workoutTypeNames([
      def('exercise', 'exercise'),
      def('running', 'exercise', 'exercise'),
      def('running', 'exercise', 'exercise'),
    ])
    expect(names).toHaveLength(new Set(names).size)
  })
})
