import type { RequestHandler } from 'express'

import {
  type ActivityTypeDefinitionResponse,
  type ActivityTypeDefinitionsResponse,
  type ActivityFieldValuesQuery,
  activityFieldValuesQuerySchema,
  type ActivityFieldValuesResponse,
  type ActivitySessionsQuery,
  activitySessionsQuerySchema,
  type ActivitySessionsResponse,
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
import {
  queryActivityFieldValues,
  queryActivitySessions,
  sessionsOptionsFromQuery,
} from '../services/queries/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createActivityTypesRouter = (authMiddleware: RequestHandler): TypedRouter => {
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

  router.get<{ name: string }, ActivitySessionsResponse, unknown, ActivitySessionsQuery>(
    '/:name/sessions',
    authMiddleware,
    validateQuery(activitySessionsQuerySchema),
    async (req, res) => {
      const sessions = await queryActivitySessions(
        req.user!,
        req.params.name,
        sessionsOptionsFromQuery(req.query),
      )
      res.json({ data: sessions, success: true })
    },
  )

  router.get<{ name: string }, ActivityFieldValuesResponse, unknown, ActivityFieldValuesQuery>(
    '/:name/field-values',
    authMiddleware,
    validateQuery(activityFieldValuesQuerySchema),
    async (req, res) => {
      const values = await queryActivityFieldValues(req.user!, req.params.name, req.query.field)
      res.json({ data: values, success: true })
    },
  )

  router.post<Record<string, never>, ActivityTypeDefinitionResponse, AddActivityTypeDefinitionBody>(
    '/',
    authMiddleware,
    validateBody(addActivityTypeDefinitionBodySchema),
    async (req, res) => {
      const result = await addActivityTypeDefinition(req.user!, req.body)

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

  return router
}
