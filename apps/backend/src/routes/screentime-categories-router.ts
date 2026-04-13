import type { RequestHandler, Router } from 'express'

/**
 * Screentime categories route group.
 *
 * Handles: /screentime-categories/*
 */
import {
  type CreateScreentimeCategoryBody,
  createScreentimeCategoryBodySchema,
  type DeleteScreentimeCategoryResponse,
  type ImportAwCategoriesBody,
  importAwCategoriesBodySchema,
  type MoveScreentimeCategoryBody,
  moveScreentimeCategoryBodySchema,
  type MoveScreentimeCategoryResponse,
  type RecategorizeScreentimeResponse,
  type ScreentimeCategoryDefaultsResponse,
  type ScreentimeCategoryListResponse,
  type ScreentimeCategoryResponse,
  type UpdateScreentimeCategoryBody,
  updateScreentimeCategoryBodySchema,
} from '@aurboda/api-spec'

import type { ScreentimeCategory as DbScreentimeCategory } from '../db/index.ts'

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

/** Serialize DB screentime category (Date timestamps) to API format (ISO strings). */
const serializeCategory = (cat: DbScreentimeCategory) => ({
  ...cat,
  created_at: cat.created_at.toISOString(),
  updated_at: cat.updated_at.toISOString(),
})

export const createScreentimeCategoriesRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  router.get<Record<string, never>, ScreentimeCategoryListResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const categories = await listCategories(user)
    res.json({ data: categories.map(serializeCategory), success: true })
  })

  router.get<{ id: string }, ScreentimeCategoryResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const category = await getCategoryById(user, req.params.id)
    if (!category) {
      res.status(404).json({ error: 'Category not found', success: false })
      return
    }
    res.json({ data: serializeCategory(category), success: true })
  })

  router.post<Record<string, never>, ScreentimeCategoryResponse, CreateScreentimeCategoryBody>(
    '/',
    authMiddleware,
    validateBody(createScreentimeCategoryBodySchema),
    async (req, res) => {
      const user = req.user!
      const category = await createCategory(user, {
        color: req.body.color,
        ignore_case: req.body.ignore_case ?? true,
        name: req.body.name,
        rule_regex: req.body.rule_regex,
        rule_type: req.body.rule_type ?? 'none',
        score: req.body.score,
        sort_order: req.body.sort_order,
      })
      res.status(201).json({ data: serializeCategory(category), success: true })
    },
  )

  router.put<{ id: string }, ScreentimeCategoryResponse, CreateScreentimeCategoryBody>(
    '/:id',
    authMiddleware,
    validateBody(createScreentimeCategoryBodySchema),
    async (req, res) => {
      const user = req.user!
      const category = await upsertCategory(user, req.params.id, {
        color: req.body.color,
        exclude_from_screentime: req.body.exclude_from_screentime,
        ignore_case: req.body.ignore_case ?? true,
        name: req.body.name,
        rule_regex: req.body.rule_regex,
        rule_type: req.body.rule_type ?? 'none',
        score: req.body.score,
        sort_order: req.body.sort_order,
      })
      res.json({ data: serializeCategory(category), success: true })
    },
  )

  router.patch<{ id: string }, ScreentimeCategoryResponse, UpdateScreentimeCategoryBody>(
    '/:id',
    authMiddleware,
    validateBody(updateScreentimeCategoryBodySchema),
    async (req, res) => {
      const user = req.user!
      const category = await modifyCategory(user, req.params.id, req.body)
      if (!category) {
        res.status(404).json({ error: 'Category not found', success: false })
        return
      }
      res.json({ data: serializeCategory(category), success: true })
    },
  )

  router.patch<{ id: string }, MoveScreentimeCategoryResponse, MoveScreentimeCategoryBody>(
    '/:id/move',
    authMiddleware,
    validateBody(moveScreentimeCategoryBodySchema),
    async (req, res) => {
      const user = req.user!
      const result = await moveCategoryToParent(user, req.params.id, req.body.new_parent_id)
      res.json({ success: result.updated > 0, updated: result.updated })
    },
  )

  router.delete<{ id: string }, DeleteScreentimeCategoryResponse>(
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

  router.post<Record<string, never>, ScreentimeCategoryListResponse, ImportAwCategoriesBody>(
    '/import-activitywatch',
    authMiddleware,
    validateBody(importAwCategoriesBodySchema),
    async (req, res) => {
      const user = req.user!

      let awCategories = req.body.categories

      if (!awCategories) {
        const serverUrl = req.body.url || 'http://localhost:5600'
        awCategories = await fetchAwCategories(serverUrl)
      }

      const result = await importFromActivityWatch(user, awCategories, req.body.replace ?? false)
      res.json({ data: result.map(serializeCategory), success: true })
    },
  )

  router.post<Record<string, never>, RecategorizeScreentimeResponse>(
    '/recategorize',
    authMiddleware,
    async (req, res) => {
      const user = req.user!

      const count = await recategorizeAll(user)
      res.json({ records_updated: count, success: true })
    },
  )

  router.get<Record<string, never>, ScreentimeCategoryDefaultsResponse>(
    '/defaults',
    authMiddleware,
    async (_req, res) => {
      const { defaultScreentimeCategories } = await import('@aurboda/api-spec')
      res.json({ data: defaultScreentimeCategories, success: true })
    },
  )

  return router as unknown as Router
}
