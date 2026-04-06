import type { RequestHandler, Router } from 'express'

/**
 * Tags route group.
 *
 * Handles: /tags/*
 */
import {
  type AddTagBody,
  addTagBodySchema,
  type AddTagResponse,
  type CreateTagDefinitionBody,
  createTagDefinitionBodySchema,
  type DeleteTagResponse,
  type MergeTagDefinitionsBody,
  mergeTagDefinitionsBodySchema,
  type ProgrammaticTagsResponse,
  type SetTagMappingBody,
  setTagMappingBodySchema,
  type SetTagMappingResponse,
  type TagDefinitionsResponse,
  type TagMappingsResponse,
  type TagsQuery,
  tagsQuerySchema,
  type TagsResponse,
  type UniqueTagsResponse,
  type UpdateTagBody,
  type UpdateTagDefinitionBody,
  updateTagBodySchema,
  updateTagDefinitionBodySchema,
} from '@aurboda/api-spec'

import {
  deleteTagDefinition,
  getProgrammaticTags,
  getTagById,
  getTagDefinitionById,
  getTagDefinitions,
  getUniqueTags,
  getUserSettings,
  insertTagDefinition,
  mergeTagDefinitions,
  updateTagDefinition,
} from '../db/index.ts'
import { addTag, deleteTag, deleteTagById, restoreTag, updateTag } from '../services/mutations.ts'
import { queryTags, type SyncProvider } from '../services/queries.ts'
import { getTagMappings, setTagMapping } from '../services/settings.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createTagsRouter = (authMiddleware: RequestHandler, syncProvider?: SyncProvider): Router => {
  const router = typedRouter()

  // GET /tags - Query tags for a time range
  router.get<Record<string, string>, TagsResponse, unknown, TagsQuery>(
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
  router.post<Record<string, string>, AddTagResponse, AddTagBody>(
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
  router.get<{ id: string }, { success: boolean; data?: unknown; error?: string }>(
    '/id/:id',
    authMiddleware,
    async (req, res) => {
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
    },
  )

  // PATCH /tags/id/:id - Update a tag's times
  router.patch<{ id: string }, { success: boolean; error?: string }, UpdateTagBody>(
    '/id/:id',
    authMiddleware,
    validateBody(updateTagBodySchema),
    async (req, res) => {
      const { id } = req.params
      const user = req.user!
      const { start_time, end_time } = req.body

      const result = await updateTag(user, id, {
        end_time: end_time === null ? null : end_time ? new Date(end_time) : undefined,
        start_time: start_time ? new Date(start_time) : undefined,
      })

      if (!result.success) {
        return res.status(result.error === 'Tag not found' ? 404 : 400).json(result)
      }

      res.json({ success: true })
    },
  )

  // DELETE /tags/id/:id - Soft-delete a tag by UUID (not external_id)
  router.delete<{ id: string }, { success: boolean; error?: string }>(
    '/id/:id',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await deleteTagById(user, id)
      if (!result.success) {
        return res.status(404).json({ error: 'Tag not found', success: false })
      }

      res.json({ success: true })
    },
  )

  // POST /tags/id/:id/restore - Restore a soft-deleted tag
  router.post<{ id: string }, { success: boolean; error?: string }>(
    '/id/:id/restore',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await restoreTag(user, id)
      if (!result.success) {
        return res.status(404).json({ error: 'Tag not found or not deleted', success: false })
      }

      res.json({ success: true })
    },
  )

  // GET /tags/unique - Get all unique tag names
  router.get<Record<string, string>, UniqueTagsResponse>('/unique', authMiddleware, async (req, res) => {
    const user = req.user!
    const tags = await getUniqueTags(user)
    res.json({ data: tags, success: true })
  })

  // GET /tags/programmatic - Get all tags with their current mappings (for tag mapper)
  router.get<Record<string, string>, ProgrammaticTagsResponse>(
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
  router.post<Record<string, string>, SetTagMappingResponse, SetTagMappingBody>(
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
  router.get<Record<string, string>, TagMappingsResponse>('/mappings', authMiddleware, async (req, res) => {
    const user = req.user!
    const result = await getTagMappings(user)
    res.json({ ...result, success: true })
  })

  // ============================================================================
  // Tag Definitions
  // ============================================================================

  // GET /tags/definitions - List all tag definitions with counts
  router.get<Record<string, string>, TagDefinitionsResponse>(
    '/definitions',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const definitions = await getTagDefinitions(user)
      const data = definitions.map((d) => ({
        aliases: d.aliases,
        count: d.count,
        created_at: d.created_at.toISOString(),
        icon: d.icon ?? null,
        id: d.id,
        latest_time: d.latest_time?.toISOString(),
        name: d.name,
        updated_at: d.updated_at.toISOString(),
      }))
      res.json({ data, success: true })
    },
  )

  // GET /tags/definitions/:id - Get a single tag definition
  router.get<{ id: string }, { success: boolean; data?: unknown; error?: string }>(
    '/definitions/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const definition = await getTagDefinitionById(user, req.params.id)
      if (!definition) {
        return res.status(404).json({ error: 'Tag definition not found', success: false })
      }
      res.json({
        data: {
          aliases: definition.aliases,
          count: definition.count,
          created_at: definition.created_at.toISOString(),
          icon: definition.icon ?? null,
          id: definition.id,
          latest_time: definition.latest_time?.toISOString(),
          name: definition.name,
          updated_at: definition.updated_at.toISOString(),
        },
        success: true,
      })
    },
  )

  // POST /tags/definitions - Create a tag definition
  router.post<Record<string, string>, { success: boolean; data: unknown }, CreateTagDefinitionBody>(
    '/definitions',
    authMiddleware,
    validateBody(createTagDefinitionBodySchema),
    async (req, res) => {
      const user = req.user!
      const definition = await insertTagDefinition(user, req.body)
      res.status(201).json({
        data: {
          aliases: definition.aliases,
          created_at: definition.created_at.toISOString(),
          icon: definition.icon ?? null,
          id: definition.id,
          name: definition.name,
          updated_at: definition.updated_at.toISOString(),
        },
        success: true,
      })
    },
  )

  // PATCH /tags/definitions/:id - Update a tag definition
  router.patch<{ id: string }, { success: boolean; data?: unknown; error?: string }, UpdateTagDefinitionBody>(
    '/definitions/:id',
    authMiddleware,
    validateBody(updateTagDefinitionBodySchema),
    async (req, res) => {
      const user = req.user!
      const definition = await updateTagDefinition(user, req.params.id, req.body)
      if (!definition) {
        return res.status(404).json({ error: 'Tag definition not found', success: false })
      }
      res.json({
        data: {
          aliases: definition.aliases,
          created_at: definition.created_at.toISOString(),
          icon: definition.icon ?? null,
          id: definition.id,
          name: definition.name,
          updated_at: definition.updated_at.toISOString(),
        },
        success: true,
      })
    },
  )

  // DELETE /tags/definitions/:id - Delete a tag definition
  router.delete<{ id: string }, { success: boolean; error?: string }>(
    '/definitions/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const deleted = await deleteTagDefinition(user, req.params.id)
      if (!deleted) {
        return res.status(404).json({ error: 'Tag definition not found', success: false })
      }
      res.json({ success: true })
    },
  )

  // POST /tags/definitions/:id/merge - Merge this definition into another
  router.post<{ id: string }, { success: boolean; data?: unknown; error?: string }, MergeTagDefinitionsBody>(
    '/definitions/:id/merge',
    authMiddleware,
    validateBody(mergeTagDefinitionsBodySchema),
    async (req, res) => {
      const user = req.user!
      const { target_id } = req.body
      const result = await mergeTagDefinitions(user, req.params.id, target_id)
      if (!result) {
        return res
          .status(400)
          .json({ error: 'Merge failed (definitions not found or same ID)', success: false })
      }
      res.json({
        data: {
          aliases: result.aliases,
          created_at: result.created_at.toISOString(),
          icon: result.icon ?? null,
          id: result.id,
          name: result.name,
          updated_at: result.updated_at.toISOString(),
        },
        success: true,
      })
    },
  )

  return router as unknown as Router
}
