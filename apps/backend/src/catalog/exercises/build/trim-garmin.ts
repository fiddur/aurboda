import { readFileSync, writeFileSync } from 'node:fs'

import { formatJson } from './json.ts'

export const GARMIN_SOURCE = {
  fetched: '2026-11-13',
  names_url: 'https://connect.garmin.com/web-translations/exercise_types/exercise_types.properties',
  url: 'https://connect.garmin.com/web-data/exercises/Exercises.json',
} as const

export interface GarminExercise {
  fit: string
  name: string
}

export interface GarminSourceFile {
  entries: GarminExercise[]
  source: typeof GARMIN_SOURCE
}

export interface RawGarminExercises {
  categories: Record<string, { exercises: Record<string, unknown> }>
}

const SKIPPED_CATEGORIES = new Set([
  'BIKE_OUTDOOR',
  'CARDIO',
  'ELLIPTICAL',
  'FLOOR_CLIMB',
  'INDOOR_BIKE',
  'RUN',
  'RUN_INDOOR',
  'STAIR_STEPPER',
])

export const parseProperties = (text: string): Map<string, string> => {
  const properties = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (line.startsWith('#') || separator < 0) continue
    const key = line.slice(0, separator)
    if (!properties.has(key)) properties.set(key, line.slice(separator + 1))
  }
  return properties
}

const titleCase = (name: string): string =>
  name
    .replaceAll(/^_+|_+$/g, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

const displayName = (category: string, name: string, names: Map<string, string>): string =>
  names.get(`${category}_${name}`) ??
  names.get(`exercise_type_${category}_${name}`) ??
  names.get(`exercise_type_${name}`) ??
  titleCase(name)

export const trimGarmin = (raw: RawGarminExercises, names: Map<string, string>): GarminSourceFile => ({
  entries: Object.entries(raw.categories)
    .filter(([category]) => !SKIPPED_CATEGORIES.has(category))
    .flatMap(([category, { exercises }]) =>
      Object.keys(exercises).map(
        (name): GarminExercise => ({
          fit: `${category}/${name}`.toLowerCase(),
          name: displayName(category, name, names),
        }),
      ),
    )
    .sort((a, b) => (a.fit < b.fit ? -1 : a.fit > b.fit ? 1 : 0)),
  source: GARMIN_SOURCE,
})

if (import.meta.main) {
  const [exercisesFile, namesFile] = process.argv.slice(2)
  if (!exercisesFile || !namesFile) {
    throw new Error('Usage: node trim-garmin.ts <Exercises.json> <exercise_types.properties>')
  }
  const result = trimGarmin(
    JSON.parse(readFileSync(exercisesFile, 'utf8')) as RawGarminExercises,
    parseProperties(readFileSync(namesFile, 'utf8')),
  )
  writeFileSync(new URL('../sources/garmin.json', import.meta.url), formatJson(result))
  console.info(`Wrote ${result.entries.length} Garmin exercises`)
}
