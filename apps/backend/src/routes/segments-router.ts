import type { RequestHandler } from 'express'

import {
  type BaseResponse,
  type CreateSegmentBody,
  createSegmentBodySchema,
  type PromoteSuggestedSegmentBody,
  promoteSuggestedSegmentBodySchema,
  type SegmentDetailResponse,
  type SegmentMatchResponse,
  type SegmentResponse,
  type SegmentsQuery,
  segmentsQuerySchema,
  type SegmentsResponse,
  type SuggestedSegmentScanResponse,
  type SuggestedSegmentsResponse,
  type UpdateSegmentBody,
  updateSegmentBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { defaultSegmentOps, type SegmentOps } from '../services/segments.ts'
import { defaultSuggestedSegmentOps, type SuggestedSegmentOps } from '../services/suggested-segments.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const isUuid = (id: string): boolean => z.string().uuid().safeParse(id).success

const NOT_FOUND = { error: 'Segment not found', success: false } as const
const SUGGESTION_NOT_FOUND = { error: 'No pending suggested segment with this ID', success: false } as const

export const createSegmentsRouter = (
  authMiddleware: RequestHandler,
  ops: SegmentOps = defaultSegmentOps,
  suggestedOps: SuggestedSegmentOps = defaultSuggestedSegmentOps,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, SegmentsResponse, unknown, SegmentsQuery>(
    '/',
    authMiddleware,
    validateQuery(segmentsQuerySchema),
    async (req, res) => {
      res.json({ data: await ops.list(req.user!, req.query), success: true })
    },
  )

  router.post<Record<string, never>, SegmentDetailResponse, CreateSegmentBody>(
    '/',
    authMiddleware,
    validateBody(createSegmentBodySchema),
    async (req, res) => {
      const result = await ops.create(req.user!, req.body)
      if (!result.ok) return res.status(400).json({ error: result.error, success: false })
      res.json({ data: result.segment, success: true })
    },
  )

  router.get<Record<string, never>, SuggestedSegmentsResponse>(
    '/suggested',
    authMiddleware,
    async (req, res) => {
      res.json({ data: await suggestedOps.list(req.user!), success: true })
    },
  )

  router.post<Record<string, never>, SuggestedSegmentScanResponse>(
    '/suggested/scan',
    authMiddleware,
    async (req, res) => {
      res.json({ data: await suggestedOps.scan(req.user!), success: true })
    },
  )

  router.post<{ id: string }, SegmentDetailResponse, PromoteSuggestedSegmentBody>(
    '/suggested/:id/promote',
    authMiddleware,
    validateBody(promoteSuggestedSegmentBodySchema),
    async (req, res) => {
      const result = isUuid(req.params.id)
        ? await suggestedOps.promote(req.user!, req.params.id, req.body)
        : null
      if (!result) return res.status(404).json(SUGGESTION_NOT_FOUND)
      if (!result.ok) return res.status(400).json({ error: result.error, success: false })
      res.json({ data: result.segment, success: true })
    },
  )

  router.post<{ id: string }, BaseResponse>('/suggested/:id/dismiss', authMiddleware, async (req, res) => {
    const dismissed = isUuid(req.params.id) && (await suggestedOps.dismiss(req.user!, req.params.id))
    if (!dismissed) return res.status(404).json(SUGGESTION_NOT_FOUND)
    res.json({ success: true })
  })

  router.get<{ id: string }, SegmentDetailResponse>('/:id', authMiddleware, async (req, res) => {
    const detail = isUuid(req.params.id) ? await ops.detail(req.user!, req.params.id) : null
    if (!detail) return res.status(404).json(NOT_FOUND)
    res.json({ data: detail, success: true })
  })

  router.patch<{ id: string }, SegmentResponse, UpdateSegmentBody>(
    '/:id',
    authMiddleware,
    validateBody(updateSegmentBodySchema),
    async (req, res) => {
      const segment = isUuid(req.params.id) ? await ops.rename(req.user!, req.params.id, req.body.name) : null
      if (!segment) return res.status(404).json(NOT_FOUND)
      res.json({ data: segment, success: true })
    },
  )

  router.delete<{ id: string }, BaseResponse>('/:id', authMiddleware, async (req, res) => {
    const deleted = isUuid(req.params.id) && (await ops.remove(req.user!, req.params.id))
    if (!deleted) return res.status(404).json(NOT_FOUND)
    res.json({ success: true })
  })

  router.post<{ id: string }, SegmentMatchResponse>('/:id/match', authMiddleware, async (req, res) => {
    const result = isUuid(req.params.id) ? await ops.match(req.user!, req.params.id) : null
    if (!result) return res.status(404).json(NOT_FOUND)
    res.json({ data: result, success: true })
  })

  return router
}
