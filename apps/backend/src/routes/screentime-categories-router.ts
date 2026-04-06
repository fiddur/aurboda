import type { RequestHandler, Router } from 'express'

/**
 * Screentime categories route group.
 *
 * Handles: /screentime-categories/*
 */
import {
  type CreateScreentimeCategoryBody,
  createScreentimeCategoryBodySchema,
  type ImportAwCategoriesBody,
  importAwCategoriesBodySchema,
  type UpdateScreentimeCategoryBody,
  updateScreentimeCategoryBodySchema,
} from '@aurboda/api-spec'

import {
  createCategory,
  fetchAwCategories,
  getCategoryById,
  importFromActivityWatch,
  listCategories,
  modifyCategory,
  moveCategoryToParent,
  recategorizeAll,
  removeCategory,
  upsertCategory,
} from '../services/screentime-categories.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createScreentimeCategoriesRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  // GET / - List all categories
  router.get<Record<string, string>, { success: boolean; data: unknown[] }>(
    '/',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const categories = await listCategories(user)
      res.json({ data: categories, success: true })
    },
  )

  // GET /:id - Get a single category
  router.get<{ id: string }, { success: boolean; data?: unknown; error?: string }>(
    '/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const category = await getCategoryById(user, req.params.id)
      if (!category) {
        res.status(404).json({ error: 'Category not found', success: false })
        return
      }
      res.json({ data: category, success: true })
    },
  )

  // POST / - Create a category
  router.post<Record<string, string>, { success: boolean; data: unknown }>(
    '/',
    authMiddleware,
    validateBody(createScreentimeCategoryBodySchema),
    async (req, res) => {
      const user = req.user!
      const body = req.body as CreateScreentimeCategoryBody
      const category = await createCategory(user, {
        color: body.color,
        ignore_case: body.ignore_case ?? true,
        name: body.name,
        rule_regex: body.rule_regex,
        rule_type: body.rule_type ?? 'none',
        score: body.score,
        sort_order: body.sort_order,
      })
      res.status(201).json({ data: category, success: true })
    },
  )

  // PUT /:id - Upsert a category (create with client-generated UUID or full update)
  router.put<{ id: string }, { success: boolean; data: unknown }>(
    '/:id',
    authMiddleware,
    validateBody(createScreentimeCategoryBodySchema),
    async (req, res) => {
      const user = req.user!
      const body = req.body as CreateScreentimeCategoryBody
      const category = await upsertCategory(user, req.params.id, {
        color: body.color,
        exclude_from_screentime: body.exclude_from_screentime,
        ignore_case: body.ignore_case ?? true,
        name: body.name,
        rule_regex: body.rule_regex,
        rule_type: body.rule_type ?? 'none',
        score: body.score,
        sort_order: body.sort_order,
      })
      res.json({ data: category, success: true })
    },
  )

  // PATCH /:id - Partial update a category
  router.patch<{ id: string }, { success: boolean; data?: unknown; error?: string }>(
    '/:id',
    authMiddleware,
    validateBody(updateScreentimeCategoryBodySchema),
    async (req, res) => {
      const user = req.user!
      const body = req.body as UpdateScreentimeCategoryBody
      const category = await modifyCategory(user, req.params.id, body)
      if (!category) {
        res.status(404).json({ error: 'Category not found', success: false })
        return
      }
      res.json({ data: category, success: true })
    },
  )

  // PATCH /:id/move - Move a category to a new parent
  router.patch<{ id: string }, { success: boolean; updated: number }>(
    '/:id/move',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const { new_parent_id } = req.body as { new_parent_id: string | null }
      const result = await moveCategoryToParent(user, req.params.id, new_parent_id)
      res.json({ success: result.updated > 0, updated: result.updated })
    },
  )

  // DELETE /:id - Delete a category and its children
  router.delete<{ id: string }, { success: boolean; deleted?: number; error?: string }>(
    '/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const count = await removeCategory(user, req.params.id)
      if (count === 0) {
        res.status(404).json({ error: 'Category not found', success: false })
        return
      }
      res.json({ deleted: count, success: true })
    },
  )

  // POST /import-activitywatch - Import categories from ActivityWatch
  router.post<Record<string, string>, { success: boolean; data?: unknown; error?: string }>(
    '/import-activitywatch',
    authMiddleware,
    validateBody(importAwCategoriesBodySchema),
    async (req, res) => {
      const user = req.user!
      const body = req.body as ImportAwCategoriesBody

      try {
        let awCategories = body.categories

        if (!awCategories) {
          // Fetch from ActivityWatch server
          const serverUrl = body.url || 'http://localhost:5600'
          awCategories = await fetchAwCategories(serverUrl)
        }

        const result = await importFromActivityWatch(user, awCategories, body.replace ?? false)
        res.json({ data: result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed'
        res.status(400).json({ error: message, success: false })
      }
    },
  )

  // POST /recategorize - Force full recategorization
  router.post<Record<string, string>, { success: boolean; records_updated?: number; error?: string }>(
    '/recategorize',
    authMiddleware,
    async (req, res) => {
      const user = req.user!

      // Start recategorization and respond immediately
      const countPromise = recategorizeAll(user)

      try {
        const count = await countPromise
        res.json({ records_updated: count, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Recategorization failed'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  // GET /defaults - Get default category suggestions
  router.get<Record<string, string>, { success: boolean; data: unknown[] }>(
    '/defaults',
    authMiddleware,
    async (_req, res) => {
      const { defaultScreentimeCategories } = await import('@aurboda/api-spec')
      res.json({ data: defaultScreentimeCategories, success: true })
    },
  )

  return router as unknown as Router
}
