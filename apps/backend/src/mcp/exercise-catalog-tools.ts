import { exerciseCatalogQuerySchema, type StoredExerciseCatalog } from '@aurboda/api-spec'
import { z } from 'zod'

import {
  getExerciseByKey,
  loadExerciseCatalog,
  searchExercises,
  toExerciseCatalogEntry,
} from '../services/exercise-catalog.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerExerciseCatalogTools = (
  server: McpServer,
  catalog: () => StoredExerciseCatalog = loadExerciseCatalog,
) => {
  server.tool(
    'search_exercise_catalog',
    [
      'Search the built-in catalogue of strength exercises by name, equipment or muscle.',
      'Each entry has a stable `key` (its identifier, never renamed or reused), a display name, aliases, a category (strength, stretching, plyometrics), the equipment it uses and the muscles it works with a recruitment weight in (0, 1].',
      '`q` matches word prefixes of names, aliases and search terms, best matches first; `name` is an exact name-or-alias lookup that returns that exercise or none.',
      '`muscle` takes a muscle or a muscle group and keeps exercises working it at weight 0.5 or more.',
      'Exercise names on logged strength sets stay free text: they are not resolved to catalogue keys.',
    ].join(' '),
    { ...exerciseCatalogQuerySchema.shape },
    async (params) => jsonResponse({ data: searchExercises(catalog(), params), success: true }),
  )

  server.tool(
    'get_exercise_catalog_entry',
    'One exercise of the built-in catalogue by its `key`: name, aliases, category, equipment, muscles with recruitment weights, and the same exercise in other datasets.',
    { key: z.string().describe('Catalogue key, e.g. dumbbell_bench_press') },
    async ({ key }) => {
      const current = catalog()
      const entry = getExerciseByKey(current, key)
      return entry
        ? jsonResponse({
            data: { entry: toExerciseCatalogEntry(entry), version: current.version },
            success: true,
          })
        : errorResponse(`Exercise not found: ${key}`)
    },
  )
}
