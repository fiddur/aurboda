import { createSharedExerciseBodySchema, updateSharedExerciseBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import {
  createSharedExercise,
  deleteSharedExercise,
  isDuplicateSharedExercise,
  listSharedExercises,
  updateSharedExercise,
} from '../db/index.ts'
import { serializeSharedExercise } from '../services/shared-exercises.ts'
import { visibilityToIsPublic } from '../services/visibility.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const EXPOSES =
  'A share shows anyone with its link the exercise’s records, trend, sets per week and every session’s sets (reps, weight, time, set type) with its date; never session titles, notes, locations or heart rate.'

export const registerSharedExerciseTools = (server: McpServer, user: string, webHost: string | undefined) => {
  const serialize = (record: Parameters<typeof serializeSharedExercise>[0]) =>
    serializeSharedExercise(record, webHost ?? '', user)

  server.tool(
    'list_shared_exercises',
    `List the user’s shared exercises: one item value of one activity type (an exercise such as sets.exercise = Bench Press), published at its share_url. ${EXPOSES}`,
    {},
    async () => jsonResponse((await listSharedExercises(user)).map(serialize)),
  )

  server.tool(
    'create_shared_exercise',
    `Share one exercise’s progress publicly: an activity type, its item path (sets.exercise) and the value. An item is shared at most once. Visibility "public" lists it on the public profile; "unlisted" (default) keeps it reachable only by its link. ${EXPOSES}`,
    { ...createSharedExerciseBodySchema.shape },
    async ({ name, visibility, ...item }) => {
      try {
        const record = await createSharedExercise(user, {
          ...item,
          is_public: visibilityToIsPublic(visibility),
          name: name ?? item.value,
        })
        return jsonResponse(serialize(record))
      } catch (error) {
        if (isDuplicateSharedExercise(error)) return errorResponse('This exercise is already shared')
        throw error
      }
    },
  )

  server.tool(
    'update_shared_exercise',
    'Rename a shared exercise or change its visibility. The slug and the shared item never change. Only provided fields are modified.',
    { id: z.string().uuid().describe('The shared exercise ID'), ...updateSharedExerciseBodySchema.shape },
    async ({ id, name, visibility }) => {
      const record = await updateSharedExercise(user, id, {
        is_public: visibility === undefined ? undefined : visibilityToIsPublic(visibility),
        name,
      })
      if (!record) return errorResponse('Shared exercise not found')
      return jsonResponse(serialize(record))
    },
  )

  server.tool(
    'delete_shared_exercise',
    'Stop sharing an exercise by ID. Its link stops resolving immediately.',
    { id: z.string().uuid().describe('The shared exercise ID') },
    async ({ id }) => {
      if (!(await deleteSharedExercise(user, id))) return errorResponse('Shared exercise not found')
      return jsonResponse({ deleted: true, id })
    },
  )
}
