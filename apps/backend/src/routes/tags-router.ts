/**
 * Tags route group.
 *
 * Handles: /tags/*
 */
import {
  type AddTagBody,
  addTagBodySchema,
  type AddTagResponse,
  type DeleteTagResponse,
  type ProgrammaticTagsResponse,
  type SetTagMappingBody,
  setTagMappingBodySchema,
  type SetTagMappingResponse,
  type TagMappingsResponse,
  type TagsQuery,
  tagsQuerySchema,
  type TagsResponse,
  type UniqueTagsResponse,
} from '@aurboda/api-spec'
import { type RequestHandler, Router } from 'express'

import { getProgrammaticTags, getTagById, getUniqueTags, getUserSettings } from '../db/index.ts'
import { addTag, deleteTag, deleteTagById, restoreTag } from '../services/mutations.ts'
import { queryTags, type SyncProvider } from '../services/queries.ts'
import { getTagMappings, setTagMapping } from '../services/settings.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createTagsRouter = (authMiddleware: RequestHandler, syncProvider?: SyncProvider): Router => {
  const router = Router()

  // GET /tags - Query tags for a time range
  router.get<Record<string, never>, TagsResponse, unknown, TagsQuery>(
    '/',
    authMiddleware,
    validateQuery(tagsQuerySchema),
    async (req, res) => {
      const { start, end } = req.query
      const user = req.user!

      const tags = await queryTags(user, new Date(start), new Date(end), syncProvider)
      res.json({ data: tags, success: true })
    },
  )

  // POST /tags - Add a manual tag
  router.post<Record<string, never>, AddTagResponse, AddTagBody>(
    '/',
    authMiddleware,
    validateBody(addTagBodySchema),
    async (req, res) => {
      const { tag, start_time, end_time, merge_span } = req.body
      const user = req.user!

      const startDate = new Date(start_time)
      const endDate = end_time ? new Date(end_time) : undefined

      const result = await addTag(user, {
        end_time: endDate,
        mergeSpan: merge_span,
        start_time: startDate,
        tag,
      })
      res.json(result)
    },
  )

  // DELETE /tags/:externalId - Delete a tag by external ID
  router.delete<{ externalId: string }, DeleteTagResponse>(
    '/:externalId',
    authMiddleware,
    async (req, res) => {
      const { externalId } = req.params
      const user = req.user!

      const result = await deleteTag(user, externalId)
      res.json(result)
    },
  )

  // GET /tags/id/:id - Get a single tag by ID (for detail page)
  router.get<{ id: string }>('/id/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const tag = await getTagById(user, id, true)
    if (!tag) {
      return res.status(404).json({ error: 'Tag not found', success: false })
    }

    res.json({
      data: {
        deleted_at: tag.deleted_at?.toISOString(),
        end_time: tag.end_time?.toISOString(),
        external_id: tag.external_id,
        id: tag.id,
        source: tag.source,
        start_time: tag.start_time.toISOString(),
        tag: tag.tag,
        tag_key: tag.tag_key,
      },
      success: true,
    })
  })

  // DELETE /tags/id/:id - Soft-delete a tag by UUID (not external_id)
  router.delete<{ id: string }>('/id/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await deleteTagById(user, id)
    if (!result.success) {
      return res.status(404).json({ error: 'Tag not found', success: false })
    }

    res.json({ success: true })
  })

  // POST /tags/id/:id/restore - Restore a soft-deleted tag
  router.post<{ id: string }>('/id/:id/restore', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await restoreTag(user, id)
    if (!result.success) {
      return res.status(404).json({ error: 'Tag not found or not deleted', success: false })
    }

    res.json({ success: true })
  })

  // GET /tags/unique - Get all unique tag names
  router.get<Record<string, never>, UniqueTagsResponse>('/unique', authMiddleware, async (req, res) => {
    const user = req.user!
    const tags = await getUniqueTags(user)
    res.json({ data: tags, success: true })
  })

  // GET /tags/programmatic - Get all tags with their current mappings (for tag mapper)
  router.get<Record<string, never>, ProgrammaticTagsResponse>(
    '/programmatic',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const tags = await getProgrammaticTags(user)
      const settings = await getUserSettings(user)
      const mappings = settings?.tag_mappings ?? {}

      const data = tags.map((tag) => ({
        count: tag.count,
        // For programmatic tags, look up the mapped name; for regular tags, the tag name IS the name
        current_name: tag.isProgrammatic ? (mappings[tag.tagKey] ?? null) : tag.tagKey,
        is_programmatic: tag.isProgrammatic,
        latest_time: tag.latestTime.toISOString(),
        tag_key: tag.tagKey,
      }))

      res.json({ data, success: true })
    },
  )

  // POST /tags/mapping - Set a tag mapping
  router.post<Record<string, never>, SetTagMappingResponse, SetTagMappingBody>(
    '/mapping',
    authMiddleware,
    validateBody(setTagMappingBodySchema),
    async (req, res) => {
      const { tag_key, name, icon } = req.body
      const user = req.user!

      const mapping = await setTagMapping(user, tag_key, name, icon)

      res.json({ mapping, success: true })
    },
  )

  // GET /tags/mappings - Get all tag mappings
  router.get<Record<string, never>, TagMappingsResponse>('/mappings', authMiddleware, async (req, res) => {
    const user = req.user!
    const result = await getTagMappings(user)
    res.json({ ...result, success: true })
  })

  return router
}
