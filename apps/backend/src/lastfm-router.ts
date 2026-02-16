/**
 * Last.fm tag rules router.
 *
 * Provides REST API endpoints for managing Last.fm auto-tagging rules.
 */

import {
  addLastFmTagRuleBodySchema,
  type AddLastFmTagRuleBody,
  type AddLastFmTagRuleResponse,
  type LastFmTagRulesResponse,
  type SyncResponse,
} from '@aurboda/api-spec'
import { RequestHandler, Router } from 'express'
import type { ParamsDictionary } from 'express-serve-static-core'
import {
  deleteLastFmTagRule,
  getLastFmTagRules,
  insertLastFmTagRule,
  type LastFmMatchMode,
  type LastFmMatchType,
} from './db'
import { validateBody } from './validation'

/**
 * Creates the Last.fm router with tag rules CRUD endpoints.
 */
export const createLastFmRouter = (authMiddleware: RequestHandler): Router => {
  const router = Router()

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

  // DELETE /lastfm/tag-rules/:id - Delete a tag rule
  router.delete<{ id: string }, SyncResponse>('/tag-rules/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const { id } = req.params

    try {
      const deleted = await deleteLastFmTagRule(user, id)
      if (!deleted) {
        return res.status(404).json({ error: 'Rule not found', success: false })
      }
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  return router
}
