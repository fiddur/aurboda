import type { RequestHandler, Router } from 'express'

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
  type MergeActivityTypeBody,
  mergeActivityTypeBodySchema,
  type MergeActivityTypeResponse,
  type RenameActivityTypeBody,
  renameActivityTypeBodySchema,
  type RenameActivityTypeResponse,
  type UpdateActivityTypeDefinitionBody,
  updateActivityTypeDefinitionBodySchema,
} from '@aurboda/api-spec'

import {
  addActivityTypeDefinition,
  deleteActivityTypeDefinition,
  listActivityTypeDefinitions,
  mergeActivityType,
  renameActivityTypeDefinition,
  updateActivityTypeDefinition,
} from '../services/activity-type-definitions.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createActivityTypesRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  router.get<Record<string, never>, ActivityTypeDefinitionsResponse>(
    '/',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const definitions = await listActivityTypeDefinitions(user)
      res.json({ data: definitions, success: true })
    },
  )

  router.post<Record<string, never>, ActivityTypeDefinitionResponse, AddActivityTypeDefinitionBody>(
    '/',
    authMiddleware,
    validateBody(addActivityTypeDefinitionBodySchema),
    async (req, res) => {
      const user = req.user!
      const { name, display_name, display_category, color, icon, data_schema } = req.body
      const result = await addActivityTypeDefinition(user, {
        color,
        data_schema,
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

  router.post<Record<string, never>, MergeActivityTypeResponse, MergeActivityTypeBody>(
    '/merge',
    authMiddleware,
    validateBody(mergeActivityTypeBodySchema),
    async (req, res) => {
      const { source, target } = req.body
      const user = req.user!
      const result = await mergeActivityType(user, source, target)
      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json(result)
    },
  )

  router.post<{ name: string }, RenameActivityTypeResponse, RenameActivityTypeBody>(
    '/:name/rename',
    authMiddleware,
    validateBody(renameActivityTypeBodySchema),
    async (req, res) => {
      const { name } = req.params
      const { new_name } = req.body
      const user = req.user!
      const result = await renameActivityTypeDefinition(user, name, new_name)

      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }

      res.json({
        activities_updated: result.activities_updated,
        data: result.data,
        deduction_rules_updated: result.deduction_rules_updated,
        success: true,
      })
    },
  )

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

  return router as unknown as Router
}
