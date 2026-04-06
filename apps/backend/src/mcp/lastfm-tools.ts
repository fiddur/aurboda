/**
 * MCP Last.fm tools: scrobble queries and tag rule management.
 */
import {
  addLastFmTagRuleBodySchema,
  scrobblesQuerySchema,
  tzSchema,
  updateLastFmTagRuleBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  deleteLastFmTagRule,
  getLastFmTagRules,
  getScrobbles,
  insertLastFmTagRule,
  updateLastFmTagRule,
  type LastFmMatchMode,
  type LastFmMatchType,
} from '../db/index.ts'
import { applyRuleRetroactively, cleanupRuleActivities, retagAllScrobbles } from '../lastfm-sync.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'
import { formatInTz } from './tz-utils.ts'

export const registerLastFmTools = (server: McpServer, user: string) => {
  // Tool: query_scrobbles
  server.tool(
    'query_scrobbles',
    'Query Last.fm scrobbles for a time range. Returns tracks played with artist, album, and timestamp.',
    { ...scrobblesQuerySchema.shape, tz: tzSchema },
    async ({ start, end, tz }) => {
      const scrobbles = await getScrobbles(user, new Date(start), new Date(end))
      const serialized = scrobbles.map((s) => ({
        album: s.album,
        artist: s.artist,
        recorded_at: formatInTz(s.recorded_at, tz),
        track: s.track,
      }))
      return tzJsonResponse({ data: serialized, success: true }, tz)
    },
  )

  // Tool: get_lastfm_tag_rules
  server.tool(
    'get_lastfm_tag_rules',
    'Get all Last.fm auto-tagging rules. These rules create tags when scrobbles match specified criteria.',
    { tz: tzSchema },
    async ({ tz }) => {
      const rules = await getLastFmTagRules(user)
      const serialized = rules.map((r) => ({
        ...r,
        created_at: formatInTz(r.created_at, tz),
      }))
      return tzJsonResponse({ data: serialized, success: true }, tz)
    },
  )

  // Tool: add_lastfm_tag_rule
  server.tool(
    'add_lastfm_tag_rule',
    'Add a Last.fm auto-tagging rule. Creates tags when scrobbles match the specified criteria. The rule is applied retroactively to all existing scrobbles.',
    { ...addLastFmTagRuleBodySchema.shape, tz: tzSchema },
    async ({
      artist_name,
      artist_names,
      match_mode,
      match_type,
      merge_gap_seconds,
      rule_name,
      tag_name,
      track_name,
      tz,
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

        // Apply the new rule retroactively to all existing scrobbles
        const tagsApplied = await applyRuleRetroactively(user, rule)

        return tzJsonResponse(
          {
            data: {
              ...rule,
              created_at: formatInTz(rule.created_at, tz),
              tags_applied: tagsApplied,
            },
            success: true,
          },
          tz,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('unique_rule')) {
          return errorResponse('A rule with the same match criteria and tag already exists')
        }
        return jsonResponse({ error: message, success: false })
      }
    },
  )

  // Tool: update_lastfm_tag_rule
  server.tool(
    'update_lastfm_tag_rule',
    'Update an existing Last.fm auto-tagging rule. Only provided fields are updated. Old auto-tags are removed and the updated rule is re-applied retroactively.',
    {
      id: z.string().uuid().describe('The ID of the rule to update'),
      ...updateLastFmTagRuleBodySchema.shape,
      tz: tzSchema,
    },
    async ({
      id,
      artist_name,
      artist_names,
      match_mode,
      match_type,
      merge_gap_seconds,
      rule_name,
      tag_name,
      track_name,
      tz,
    }) => {
      try {
        // Clean up old auto-tags before updating
        await cleanupRuleActivities(user, id)

        const updated = await updateLastFmTagRule(user, id, {
          artist_name,
          artist_names,
          match_mode: match_mode as LastFmMatchMode | undefined,
          match_type: match_type as LastFmMatchType | undefined,
          merge_gap_seconds: merge_gap_seconds ?? undefined,
          rule_name,
          tag_name,
          track_name,
        })

        if (!updated) {
          return jsonResponse({ error: 'Rule not found', success: false })
        }

        const tagsApplied = await applyRuleRetroactively(user, updated)

        return tzJsonResponse(
          {
            data: {
              ...updated,
              created_at: formatInTz(updated.created_at, tz),
              tags_applied: tagsApplied,
            },
            success: true,
          },
          tz,
        )
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
    'Delete a Last.fm auto-tagging rule by its ID. Also removes all auto-generated tags from this rule.',
    {
      rule_id: z.string().uuid().describe('The ID of the rule to delete'),
    },
    async ({ rule_id }) => {
      const tagsRemoved = await cleanupRuleActivities(user, rule_id)
      const deleted = await deleteLastFmTagRule(user, rule_id)
      if (!deleted) {
        return jsonResponse({ error: 'Rule not found', success: false })
      }
      return jsonResponse({ success: true, tags_removed: tagsRemoved })
    },
  )

  // Tool: retag_lastfm_scrobbles
  server.tool(
    'retag_lastfm_scrobbles',
    'Delete all auto-generated Last.fm tags and reapply all rules from scratch. Use after changing rules to fix tagging.',
    {},
    async () => {
      const result = await retagAllScrobbles(user)
      return jsonResponse({
        success: true,
        tags_created: result.tags_created,
        tags_deleted: result.tags_deleted,
      })
    },
  )
}
