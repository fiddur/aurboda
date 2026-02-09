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
        artistName: r.artistName,
        createdAt: r.createdAt.toISOString(),
        id: r.id,
        matchMode: r.matchMode,
        matchType: r.matchType,
        ruleName: r.ruleName,
        tagName: r.tagName,
        trackName: r.trackName,
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
      const { ruleName, matchType, trackName, artistName, matchMode, tagName } = req.body

      // Validate required fields based on match_type
      if ((matchType === 'track' || matchType === 'track_artist') && !trackName) {
        return res
          .status(400)
          .json({ error: `trackName is required for matchType "${matchType}"`, success: false })
      }
      if ((matchType === 'artist' || matchType === 'track_artist') && !artistName) {
        return res
          .status(400)
          .json({ error: `artistName is required for matchType "${matchType}"`, success: false })
      }

      try {
        const rule = await insertLastFmTagRule(user, {
          artistName,
          matchMode: (matchMode ?? 'exact') as LastFmMatchMode,
          matchType: matchType as LastFmMatchType,
          ruleName,
          tagName,
          trackName,
        })

        res.json({
          data: {
            artistName: rule.artistName,
            createdAt: rule.createdAt.toISOString(),
            id: rule.id,
            matchMode: rule.matchMode,
            matchType: rule.matchType,
            ruleName: rule.ruleName,
            tagName: rule.tagName,
            trackName: rule.trackName,
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
