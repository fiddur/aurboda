import type { RequestHandler } from 'express'

import {
  type BaseResponse,
  type MergeRoutesBody,
  mergeRoutesBodySchema,
  type MergeRoutesResponse,
  type RouteDetailResponse,
  type RouteMatchResponse,
  type RouteResponse,
  type RoutesResponse,
  type UpdateRouteBody,
  updateRouteBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { defaultRouteOps, type RouteOps } from '../services/routes.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

const isUuid = (id: string): boolean => z.string().uuid().safeParse(id).success

const NOT_FOUND = { error: 'Route not found', success: false } as const

export const createRoutesRouter = (
  authMiddleware: RequestHandler,
  ops: RouteOps = defaultRouteOps,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, RoutesResponse>('/', authMiddleware, async (req, res) => {
    res.json({ data: await ops.list(req.user!), success: true })
  })

  router.post<Record<string, never>, RouteMatchResponse>('/match', authMiddleware, async (req, res) => {
    res.json({ data: await ops.match(req.user!), success: true })
  })

  router.get<{ id: string }, RouteDetailResponse>('/:id', authMiddleware, async (req, res) => {
    const detail = isUuid(req.params.id) ? await ops.detail(req.user!, req.params.id) : null
    if (!detail) return res.status(404).json(NOT_FOUND)
    res.json({ data: detail, success: true })
  })

  router.patch<{ id: string }, RouteResponse, UpdateRouteBody>(
    '/:id',
    authMiddleware,
    validateBody(updateRouteBodySchema),
    async (req, res) => {
      const route = isUuid(req.params.id) ? await ops.rename(req.user!, req.params.id, req.body.name) : null
      if (!route) return res.status(404).json(NOT_FOUND)
      res.json({ data: route, success: true })
    },
  )

  router.delete<{ id: string }, BaseResponse>('/:id', authMiddleware, async (req, res) => {
    const deleted = isUuid(req.params.id) && (await ops.remove(req.user!, req.params.id))
    if (!deleted) return res.status(404).json(NOT_FOUND)
    res.json({ success: true })
  })

  router.post<{ id: string }, MergeRoutesResponse, MergeRoutesBody>(
    '/:id/merge',
    authMiddleware,
    validateBody(mergeRoutesBodySchema),
    async (req, res) => {
      const result = isUuid(req.params.id)
        ? await ops.merge(req.user!, req.params.id, req.body.source_route_id)
        : null
      if (!result) return res.status(404).json(NOT_FOUND)
      res.json({ data: result, success: true })
    },
  )

  return router
}
