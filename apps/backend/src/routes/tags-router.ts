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
import { RequestHandler, Router } from 'express'
import { getProgrammaticTags, getUniqueTags, getUserSettings, upsertUserSettings } from '../db'
import { addTag, deleteTag } from '../services/mutations'
import { queryTags, type SyncProvider } from '../services/queries'
import { validateBody, validateQuery } from '../validation'

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

  // GET /tags/unique - Get all unique tag names
  router.get<Record<string, never>, UniqueTagsResponse>('/unique', authMiddleware, async (req, res) => {
    const user = req.user!
    const tags = await getUniqueTags(user)
    res.json({ data: tags, success: true })
  })

  // GET /tags/programmatic - Get all programmatic tags with their current mappings
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
        current_name: mappings[tag.tagKey] ?? null,
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
      const { tag_key, name } = req.body
      const user = req.user!

      const settings = await getUserSettings(user)
      const currentMappings = settings?.tag_mappings ?? {}
      const newMappings = { ...currentMappings, [tag_key]: name }

      await upsertUserSettings(user, { tag_mappings: newMappings })

      res.json({ mapping: newMappings, success: true })
    },
  )

  // GET /tags/mappings - Get all tag mappings
  router.get<Record<string, never>, TagMappingsResponse>('/mappings', authMiddleware, async (req, res) => {
    const user = req.user!
    const settings = await getUserSettings(user)
    res.json({ mappings: settings?.tag_mappings ?? {}, success: true })
  })

  return router
}
