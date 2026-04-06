/**
 * Activity type definitions route group.
 *
 * Handles: /activity-types/*
 */
import {
  type ActivityTypeDefinitionResponse,
  type ActivityTypeDefinitionsResponse,
  type AddActivityTypeDefinitionBody,
  addActivityTypeDefinitionBodySchema,
  type UpdateActivityTypeDefinitionBody,
  updateActivityTypeDefinitionBodySchema,
} from '@aurboda/api-spec'
import { type RequestHandler, Router } from 'express'

import {
  addActivityTypeDefinition,
  deleteActivityTypeDefinition,
  listActivityTypeDefinitions,
  updateActivityTypeDefinition,
} from '../services/activity-type-definitions.ts'
import { validateBody } from '../validation.ts'

export const createActivityTypesRouter = (authMiddleware: RequestHandler): Router => {
  const router = Router()

  // GET / - List all activity type definitions
  router.get<Record<string, never>, ActivityTypeDefinitionsResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const definitions = await listActivityTypeDefinitions(user)
    res.json({ data: definitions, success: true })
  })

  // POST / - Create a custom activity type
  router.post<Record<string, never>, ActivityTypeDefinitionResponse, AddActivityTypeDefinitionBody>(
    '/',
    authMiddleware,
    validateBody(addActivityTypeDefinitionBodySchema),
    async (req, res) => {
      const user = req.user!
      const { name, display_name, display_category, color, icon } = req.body
      const result = await addActivityTypeDefinition(user, {
        color,
        display_category,
        display_name,
        icon,
        name,
      })

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.status(201).json({ data: result.data, success: true })
    },
  )

  // PATCH /:name - Update an activity type definition
  router.patch<{ name: string }, ActivityTypeDefinitionResponse, UpdateActivityTypeDefinitionBody>(
    '/:name',
    authMiddleware,
    validateBody(updateActivityTypeDefinitionBodySchema),
    async (req, res) => {
      const { name } = req.params
      const user = req.user!
      const result = await updateActivityTypeDefinition(user, name, req.body)

      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  // DELETE /:name - Delete a custom activity type
  router.delete<{ name: string }, ActivityTypeDefinitionResponse>(
    '/:name',
    authMiddleware,
    async (req, res) => {
      const { name } = req.params
      const user = req.user!
      const result = await deleteActivityTypeDefinition(user, name)

      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }

      res.json({ success: true })
    },
  )

  return router
}
