/**
 * Last.fm tag rules router.
 *
 * Provides REST API endpoints for managing Last.fm auto-tagging rules.
 */

import type { RequestHandler, Router } from 'express'
import type { ParamsDictionary } from 'express-serve-static-core'

import {
  addLastFmTagRuleBodySchema,
  updateLastFmTagRuleBodySchema,
  type AddLastFmTagRuleBody,
  type AddLastFmTagRuleResponse,
  type DeleteLastFmTagRuleResponse,
  type LastFmTagRulesResponse,
  type RetagLastFmResponse,
  type ScrobblesResponse,
  type UpdateLastFmTagRuleBody,
  type UpdateLastFmTagRuleResponse,
} from '@aurboda/api-spec'

import {
  deleteLastFmTagRule,
  getLastFmTagRules,
  getScrobbles,
  insertLastFmTagRule,
  updateLastFmTagRule,
  type LastFmMatchMode,
  type LastFmMatchType,
} from './db/index.ts'
import { applyRuleRetroactively, cleanupRuleTags, retagAllScrobbles } from './lastfm-sync.ts'
import { typedRouter } from './typed-router.ts'
import { validateBody } from './validation.ts'

/**
 * Creates the Last.fm router with tag rules CRUD endpoints.
 */
export const createLastFmRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  // GET /lastfm/scrobbles - Query scrobbles by time range
  router.get<ParamsDictionary, ScrobblesResponse>('/scrobbles', authMiddleware, async (req, res) => {
    const user = req.user!
    const { start, end } = req.query as { start?: string; end?: string }

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end query parameters are required', success: false })
    }

    try {
      const scrobbles = await getScrobbles(user, new Date(start), new Date(end))
      const serialized = scrobbles.map((s) => ({
        album: s.album,
        artist: s.artist,
        recorded_at: s.recorded_at.toISOString(),
        track: s.track,
      }))
      res.json({ data: serialized, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // GET /lastfm/tag-rules - List all tag rules
  router.get<ParamsDictionary, LastFmTagRulesResponse>('/tag-rules', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const rules = await getLastFmTagRules(user)
      const serialized = rules.map((r) => ({
        artist_name: r.artist_name,
        artist_names: r.artist_names,
        created_at: r.created_at.toISOString(),
        id: r.id,
        match_mode: r.match_mode,
        match_type: r.match_type,
        merge_gap_seconds: r.merge_gap_seconds ?? null,
        rule_name: r.rule_name,
        tag_name: r.tag_name,
        track_name: r.track_name,
      }))
      res.json({ data: serialized, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false } as LastFmTagRulesResponse)
    }
  })

  // POST /lastfm/tag-rules - Create a new tag rule
  router.post<ParamsDictionary, AddLastFmTagRuleResponse, AddLastFmTagRuleBody>(
    '/tag-rules',
    authMiddleware,
    validateBody(addLastFmTagRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      const {
        rule_name,
        match_type,
        track_name,
        artist_name,
        artist_names,
        match_mode,
        tag_name,
        merge_gap_seconds,
      } = req.body

      // Validate required fields based on match_type
      if ((match_type === 'track' || match_type === 'track_artist') && !track_name) {
        return res
          .status(400)
          .json({ error: `track_name is required for match_type "${match_type}"`, success: false })
      }
      const hasArtist = artist_name || (artist_names && artist_names.length > 0)
      if ((match_type === 'artist' || match_type === 'track_artist') && !hasArtist) {
        return res.status(400).json({
          error: `artist_name or artist_names is required for match_type "${match_type}"`,
          success: false,
        })
      }

      try {
        const rule = await insertLastFmTagRule(user, {
          artist_name,
          artist_names,
          match_mode: (match_mode ?? 'exact') as LastFmMatchMode,
          match_type: match_type as LastFmMatchType,
          merge_gap_seconds: merge_gap_seconds ?? undefined,
          rule_name,
          tag_name,
          track_name,
        })

        // Apply the new rule retroactively to all existing scrobbles
        const tagsApplied = await applyRuleRetroactively(user, rule)

        res.json({
          data: {
            artist_name: rule.artist_name,
            artist_names: rule.artist_names,
            created_at: rule.created_at.toISOString(),
            id: rule.id,
            match_mode: rule.match_mode,
            match_type: rule.match_type,
            merge_gap_seconds: rule.merge_gap_seconds ?? null,
            rule_name: rule.rule_name,
            tag_name: rule.tag_name,
            tags_applied: tagsApplied,
            track_name: rule.track_name,
          },
          success: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        // Check for unique constraint violation
        if (message.includes('unique_rule')) {
          return res
            .status(409)
            .json({ error: 'A rule with the same match criteria and tag already exists', success: false })
        }
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  // PUT /lastfm/tag-rules/:id - Update a tag rule
  router.put<{ id: string }, UpdateLastFmTagRuleResponse, UpdateLastFmTagRuleBody>(
    '/tag-rules/:id',
    authMiddleware,
    validateBody(updateLastFmTagRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      const { id } = req.params

      try {
        // Clean up old auto-tags before updating
        await cleanupRuleTags(user, id)

        const updated = await updateLastFmTagRule(user, id, {
          artist_name: req.body.artist_name,
          artist_names: req.body.artist_names,
          match_mode: req.body.match_mode as LastFmMatchMode | undefined,
          match_type: req.body.match_type as LastFmMatchType | undefined,
          merge_gap_seconds: req.body.merge_gap_seconds ?? undefined,
          rule_name: req.body.rule_name,
          tag_name: req.body.tag_name,
          track_name: req.body.track_name,
        })

        if (!updated) {
          return res.status(404).json({ error: 'Rule not found', success: false })
        }

        // Re-apply the updated rule retroactively
        const tagsApplied = await applyRuleRetroactively(user, updated)

        res.json({
          data: {
            artist_name: updated.artist_name,
            artist_names: updated.artist_names,
            created_at: updated.created_at.toISOString(),
            id: updated.id,
            match_mode: updated.match_mode,
            match_type: updated.match_type,
            merge_gap_seconds: updated.merge_gap_seconds ?? null,
            rule_name: updated.rule_name,
            tag_name: updated.tag_name,
            tags_applied: tagsApplied,
            track_name: updated.track_name,
          },
          success: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('unique_rule')) {
          return res
            .status(409)
            .json({ error: 'A rule with the same match criteria and tag already exists', success: false })
        }
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  // DELETE /lastfm/tag-rules/:id - Delete a tag rule and its auto-generated tags
  router.delete<{ id: string }, DeleteLastFmTagRuleResponse>(
    '/tag-rules/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const { id } = req.params

      try {
        const tagsRemoved = await cleanupRuleTags(user, id)
        const deleted = await deleteLastFmTagRule(user, id)
        if (!deleted) {
          return res.status(404).json({ error: 'Rule not found', success: false })
        }
        res.json({ success: true, tags_removed: tagsRemoved })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  // POST /lastfm/retag - Delete all auto-tags and reapply all rules from scratch
  router.post<ParamsDictionary, RetagLastFmResponse>('/retag', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const result = await retagAllScrobbles(user)
      res.json({
        success: true,
        tags_created: result.tags_created,
        tags_deleted: result.tags_deleted,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  return router as unknown as Router
}
