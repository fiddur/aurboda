import type { RequestHandler } from 'express'

import {
  type ActivityTypeDefinitionResponse,
  type ActivityTypeDefinitionsResponse,
  type ActivityFieldValuesQuery,
  activityFieldValuesQuerySchema,
  type ActivityFieldValuesResponse,
  type ActivityRecordsQuery,
  activityRecordsQuerySchema,
  type ActivityRecordsResponse,
  type ActivitySessionsQuery,
  activitySessionsQuerySchema,
  type ActivitySessionsResponse,
  type ActivityTypeSummaryQuery,
  activityTypeSummaryQuerySchema,
  type ActivityTypeSummaryResponse,
  type AddActivityTypeDefinitionBody,
  addActivityTypeDefinitionBodySchema,
  type BaseResponse,
  type ItemValueAliasesQuery,
  itemValueAliasesQuerySchema,
  type ItemValueAliasesResponse,
  type ItemValueIdentityQuery,
  itemValueIdentityQuerySchema,
  type ItemValueIdentityResponse,
  type MergeActivityTypeBody,
  mergeActivityTypeBodySchema,
  type MergeActivityTypeResponse,
  type MergeItemValuesBody,
  mergeItemValuesBodySchema,
  type MergeItemValuesResponse,
  type RenameActivityTypeBody,
  renameActivityTypeBodySchema,
  type RenameActivityTypeResponse,
  type SetItemValueIdentityBody,
  setItemValueIdentityBodySchema,
  type UnmappedItemValuesQuery,
  unmappedItemValuesQuerySchema,
  type UnmappedItemValuesResponse,
  type UpdateActivityTypeDefinitionBody,
  updateActivityTypeDefinitionBodySchema,
} from '@aurboda/api-spec'

import { getActivityRecords } from '../services/activity-records.ts'
import {
  addActivityTypeDefinition,
  addCatalogFieldsToActivityType,
  deleteActivityTypeDefinition,
  listActivityTypeDefinitions,
  mergeActivityType,
  renameActivityTypeDefinition,
  updateActivityTypeDefinition,
} from '../services/activity-type-definitions.ts'
import { deleteAlias, listAliases, mergeItemValues } from '../services/item-value-aliases.ts'
import {
  clearItemValueIdentity,
  getItemValueIdentity,
  listUnmappedItemValues,
  setItemValueIdentity,
} from '../services/item-value-identities.ts'
import {
  getActivityTypeSummary,
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

  router.get<{ name: string }, ActivityRecordsResponse, unknown, ActivityRecordsQuery>(
    '/:name/records',
    authMiddleware,
    validateQuery(activityRecordsQuerySchema),
    async (req, res) => {
      const records = await getActivityRecords(req.user!, req.params.name, req.query)
      res.json({ data: records, success: true })
    },
  )

  router.get<{ name: string }, ActivityTypeSummaryResponse, unknown, ActivityTypeSummaryQuery>(
    '/:name/summary',
    authMiddleware,
    validateQuery(activityTypeSummaryQuerySchema),
    async (req, res) => {
      const summary = await getActivityTypeSummary(req.user!, req.params.name, req.query)
      res.json({ data: summary, success: true })
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

  router.post<{ name: string }, MergeItemValuesResponse, MergeItemValuesBody>(
    '/:name/item-values/merge',
    authMiddleware,
    validateBody(mergeItemValuesBodySchema),
    async (req, res) => {
      const result = await mergeItemValues(req.user!, req.params.name, req.body)
      if (!result.success) {
        const status = result.error.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.get<{ name: string }, ItemValueAliasesResponse, unknown, ItemValueAliasesQuery>(
    '/:name/item-values/aliases',
    authMiddleware,
    validateQuery(itemValueAliasesQuerySchema),
    async (req, res) => {
      const result = await listAliases(req.user!, req.params.name, req.query.field)
      if (!result.success) {
        const status = result.error.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.delete<{ name: string; id: string }, BaseResponse>(
    '/:name/item-values/aliases/:id',
    authMiddleware,
    async (req, res) => {
      const result = await deleteAlias(req.user!, req.params.id)
      if (!result.success) return res.status(404).json({ error: result.error, success: false })
      res.json({ success: true })
    },
  )

  router.get<{ name: string }, ItemValueIdentityResponse, unknown, ItemValueIdentityQuery>(
    '/:name/item-values/identity',
    authMiddleware,
    validateQuery(itemValueIdentityQuerySchema),
    async (req, res) => {
      const result = await getItemValueIdentity(req.user!, req.params.name, req.query.field, req.query.value)
      if (!result.success) {
        const status = result.error.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.put<{ name: string }, ItemValueIdentityResponse, SetItemValueIdentityBody>(
    '/:name/item-values/identity',
    authMiddleware,
    validateBody(setItemValueIdentityBodySchema),
    async (req, res) => {
      const result = await setItemValueIdentity(req.user!, req.params.name, req.body)
      if (!result.success) {
        const status = result.error.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.delete<{ name: string }, BaseResponse, unknown, ItemValueIdentityQuery>(
    '/:name/item-values/identity',
    authMiddleware,
    validateQuery(itemValueIdentityQuerySchema),
    async (req, res) => {
      const result = await clearItemValueIdentity(
        req.user!,
        req.params.name,
        req.query.field,
        req.query.value,
      )
      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ success: true })
    },
  )

  router.get<{ name: string }, UnmappedItemValuesResponse, unknown, UnmappedItemValuesQuery>(
    '/:name/item-values/unmapped',
    authMiddleware,
    validateQuery(unmappedItemValuesQuerySchema),
    async (req, res) => {
      const result = await listUnmappedItemValues(req.user!, req.params.name, req.query.field)
      if (!result.success) {
        const status = result.error.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
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
      const { set_data, source, target } = req.body
      const user = req.user!
      const result = await mergeActivityType(user, source, target, set_data)
      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json(result)
    },
  )

  router.post<{ name: string }, ActivityTypeDefinitionResponse>(
    '/:name/catalog-fields',
    authMiddleware,
    async (req, res) => {
      const result = await addCatalogFieldsToActivityType(req.user!, req.params.name)
      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
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
