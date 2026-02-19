/**
 * MCP Last.fm tools: scrobble queries and tag rule management.
 */
import { addLastFmTagRuleBodySchema, scrobblesQuerySchema } from '@aurboda/api-spec'
import { z } from 'zod'
import {
  deleteLastFmTagRule,
  getLastFmTagRules,
  getScrobbles,
  insertLastFmTagRule,
  type LastFmMatchMode,
  type LastFmMatchType,
} from '../db'
import { errorResponse, jsonResponse, type McpServer } from './helpers'

export const registerLastFmTools = (server: McpServer, user: string) => {
  // Tool: query_scrobbles
  server.tool(
    'query_scrobbles',
    'Query Last.fm scrobbles for a time range. Returns tracks played with artist, album, and timestamp.',
    { ...scrobblesQuerySchema.shape },
    async ({ start, end }) => {
      const scrobbles = await getScrobbles(user, new Date(start), new Date(end))
      const serialized = scrobbles.map((s) => ({
        album: s.album,
        artist: s.artist,
        recorded_at: s.recorded_at.toISOString(),
        track: s.track,
      }))
      return jsonResponse({ data: serialized, success: true })
    },
  )

  // Tool: get_lastfm_tag_rules
  server.tool(
    'get_lastfm_tag_rules',
    'Get all Last.fm auto-tagging rules. These rules create tags when scrobbles match specified criteria.',
    {},
    async () => {
      const rules = await getLastFmTagRules(user)
      const serialized = rules.map((r) => ({
        ...r,
        created_at: r.created_at.toISOString(),
      }))
      return jsonResponse({ data: serialized, success: true })
    },
  )

  // Tool: add_lastfm_tag_rule
  server.tool(
    'add_lastfm_tag_rule',
    'Add a Last.fm auto-tagging rule. Creates tags when scrobbles match the specified criteria.',
    { ...addLastFmTagRuleBodySchema.shape },
    async ({
      artist_name,
      artist_names,
      match_mode,
      match_type,
      merge_gap_seconds,
      rule_name,
      tag_name,
      track_name,
    }) => {
      if ((match_type === 'track' || match_type === 'track_artist') && !track_name) {
        return errorResponse(`track_name is required for match_type "${match_type}"`)
      }
      const hasArtist = artist_name || (artist_names && artist_names.length > 0)
      if ((match_type === 'artist' || match_type === 'track_artist') && !hasArtist) {
        return errorResponse(`artist_name or artist_names is required for match_type "${match_type}"`)
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

        return jsonResponse({
          data: {
            ...rule,
            created_at: rule.created_at.toISOString(),
          },
          success: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('unique_rule')) {
          return errorResponse('A rule with the same match criteria and tag already exists')
        }
        return jsonResponse({ error: message, success: false })
      }
    },
  )

  // Tool: delete_lastfm_tag_rule
  server.tool(
    'delete_lastfm_tag_rule',
    'Delete a Last.fm auto-tagging rule by its ID.',
    {
      rule_id: z.string().uuid().describe('The ID of the rule to delete'),
    },
    async ({ rule_id }) => {
      const deleted = await deleteLastFmTagRule(user, rule_id)
      if (!deleted) {
        return jsonResponse({ error: 'Rule not found', success: false })
      }
      return jsonResponse({ success: true })
    },
  )
}
