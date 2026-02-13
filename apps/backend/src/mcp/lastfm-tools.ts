/**
 * MCP Last.fm tag rule tools.
 */
import { z } from 'zod'
import {
  deleteLastFmTagRule,
  getLastFmTagRules,
  insertLastFmTagRule,
  type LastFmMatchMode,
  type LastFmMatchType,
} from '../db'
import { errorResponse, jsonResponse, type McpServer } from './helpers'

// eslint-disable-next-line max-lines-per-function -- tool registrations are inherently long
export const registerLastFmTools = (server: McpServer, user: string) => {
  // Tool: get_lastfm_tag_rules
  server.tool(
    'get_lastfm_tag_rules',
    'Get all Last.fm auto-tagging rules. These rules create tags when scrobbles match specified criteria.',
    {},
    async () => {
      const rules = await getLastFmTagRules(user)
      const serialized = rules.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }))
      return jsonResponse({ data: serialized, success: true })
    },
  )

  // Tool: add_lastfm_tag_rule
  server.tool(
    'add_lastfm_tag_rule',
    'Add a Last.fm auto-tagging rule. Creates tags when scrobbles match the specified criteria.',
    {
      artist_name: z
        .string()
        .optional()
        .describe('Artist name to match (required for artist or track_artist match type)'),
      match_mode: z
        .enum(['exact', 'contains'])
        .optional()
        .describe('Match mode: exact (case-insensitive) or contains (substring). Default: exact'),
      match_type: z
        .enum(['track', 'artist', 'track_artist'])
        .describe(
          'Type of match: track (any track with name), artist (any track by artist), track_artist (exact track + artist)',
        ),
      rule_name: z.string().min(1).describe('Human-readable name for the rule'),
      tag_name: z.string().min(1).describe('Tag to create when rule matches'),
      track_name: z
        .string()
        .optional()
        .describe('Track name to match (required for track or track_artist match type)'),
    },
    async ({ artist_name, match_mode, match_type, rule_name, tag_name, track_name }) => {
      if ((match_type === 'track' || match_type === 'track_artist') && !track_name) {
        return errorResponse(`track_name is required for match_type "${match_type}"`)
      }
      if ((match_type === 'artist' || match_type === 'track_artist') && !artist_name) {
        return errorResponse(`artist_name is required for match_type "${match_type}"`)
      }

      try {
        const rule = await insertLastFmTagRule(user, {
          artistName: artist_name,
          matchMode: (match_mode ?? 'exact') as LastFmMatchMode,
          matchType: match_type as LastFmMatchType,
          ruleName: rule_name,
          tagName: tag_name,
          trackName: track_name,
        })

        return jsonResponse({
          data: {
            ...rule,
            createdAt: rule.createdAt.toISOString(),
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
