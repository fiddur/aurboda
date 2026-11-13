import type { ExerciseCategory, ExerciseEquipment, ExerciseMuscle } from '@aurboda/api-spec'

import { readFileSync, writeFileSync } from 'node:fs'

import { formatJson } from './json.ts'

export const FREE_EXERCISE_DB_SOURCE = {
  commit: 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5',
  license: 'Unlicense',
  url: 'https://github.com/yuhonas/free-exercise-db',
} as const

const muscles: Record<string, ExerciseMuscle> = {
  abdominals: 'abdominals',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower_back',
  'middle back': 'middle_back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
}

const equipment: Record<string, ExerciseEquipment | null> = {
  bands: 'bands',
  barbell: 'barbell',
  'body only': null,
  cable: 'cable',
  dumbbell: 'dumbbell',
  'e-z curl bar': 'ez_bar',
  'exercise ball': 'exercise_ball',
  'foam roll': 'foam_roll',
  kettlebells: 'kettlebell',
  machine: 'machine',
  'medicine ball': 'medicine_ball',
  other: 'other',
}

const categories: Record<string, ExerciseCategory | null> = {
  cardio: null,
  'olympic weightlifting': 'strength',
  plyometrics: 'plyometrics',
  powerlifting: 'strength',
  strength: 'strength',
  stretching: 'stretching',
  strongman: 'strength',
}

export interface RawFreeExercise {
  category: string
  equipment: string | null
  id: string
  name: string
  primaryMuscles: string[]
  secondaryMuscles: string[]
}

export interface FreeExercise {
  category: ExerciseCategory
  equipment: ExerciseEquipment[]
  id: string
  muscles: Partial<Record<ExerciseMuscle, number>>
  name: string
}

export interface FreeExerciseSourceFile {
  entries: FreeExercise[]
  source: typeof FREE_EXERCISE_DB_SOURCE
}

const lookup = <T>(table: Record<string, T>, value: string, what: string, id: string): T => {
  if (!(value in table)) throw new Error(`Unknown ${what} '${value}' on ${id}`)
  return table[value] as T
}

export const trimExercise = (raw: RawFreeExercise): FreeExercise | undefined => {
  const category = lookup(categories, raw.category, 'category', raw.id)
  if (!category) return undefined
  const gear = raw.equipment === null ? null : lookup(equipment, raw.equipment, 'equipment', raw.id)
  const weights: Partial<Record<ExerciseMuscle, number>> = {}
  for (const name of raw.secondaryMuscles) weights[lookup(muscles, name, 'muscle', raw.id)] = 0.5
  for (const name of raw.primaryMuscles) weights[lookup(muscles, name, 'muscle', raw.id)] = 1
  return { category, equipment: gear ? [gear] : [], id: raw.id, muscles: weights, name: raw.name }
}

export const trimFreeExerciseDb = (raw: RawFreeExercise[]): FreeExerciseSourceFile => ({
  entries: raw.flatMap((exercise) => trimExercise(exercise) ?? []),
  source: FREE_EXERCISE_DB_SOURCE,
})

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: node trim-free-exercise-db.ts <free-exercise-db dist/exercises.json>')
  const result = trimFreeExerciseDb(JSON.parse(readFileSync(file, 'utf8')) as RawFreeExercise[])
  writeFileSync(new URL('../sources/free-exercise-db.json', import.meta.url), formatJson(result))
  console.info(`Wrote ${result.entries.length} free-exercise-db exercises`)
}
