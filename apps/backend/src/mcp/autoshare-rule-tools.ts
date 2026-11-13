/**
 * MCP auto-share rule tools (#903) — mirrors the REST `/autoshare-rules`
 * capabilities: CRUD over the rules that automatically publish settled
 * activities to the federated feed, plus a dry-run preview. Rules are always
 * created DISABLED; enabling (via `update_autoshare_rule`) is the deliberate
 * act that lets data leave the instance, and it only affects activities that
 * arrive afterwards.
 */
import {
  addAutoshareRuleBodySchema,
  skipAutoshareBodySchema,
  updateAutoshareRuleBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { AutoshareRuleRecord } from '../db/index.ts'
import type { AutoshareGroupMember } from '../services/autoshare-deps.ts'
import type { SkipAutoshare } from '../services/autoshare-skip.ts'
import type { AutosharePreviewDeps as PreviewDeps } from '../services/autoshare.ts'

import {
  countAutosharePostsByRule,
  deleteAutoshareRule,
  getAutoshareRules,
  insertAutoshareRule,
  updateAutoshareRule,
} from '../db/index.ts'
import {
  autoshareRuleInputFromBody,
  autoshareRulePatchFromBody,
  serializeAutoshareRule,
} from '../routes/autoshare-rules-router.ts'
import { PREVIEW_SAMPLE_DAYS, previewAutoshareRule } from '../services/autoshare.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export type AutosharePreviewDeps = PreviewDeps<AutoshareGroupMember>

export const registerAutoshareRuleTools = (
  server: McpServer,
  user: string,
  previewDeps: AutosharePreviewDeps,
  skip?: SkipAutoshare,
) => {
  server.tool(
    'list_autoshare_rules',
    'List your auto-share rules (predicate + share template + enabled state) with how many posts each has auto-created.',
    {},
    async () => {
      const [rules, counts] = await Promise.all([getAutoshareRules(user), countAutosharePostsByRule(user)])
      return jsonResponse({ post_counts: counts, rules: rules.map(serializeAutoshareRule) })
    },
  )

  server.tool(
    'add_autoshare_rule',
    'Create an auto-share rule (e.g. "share runs longer than 15 minutes", or with data_filters "share yoga sessions that have a session name"). The rule is created DISABLED — enable it with update_autoshare_rule once the user has confirmed what it will publish. Auto-created posts share the listed metrics/series at the given visibility, exactly like a manual share.',
    { ...addAutoshareRuleBodySchema.shape },
    async (body) => {
      const record = await insertAutoshareRule(user, autoshareRuleInputFromBody(body))
      return jsonResponse(serializeAutoshareRule(record))
    },
  )

  server.tool(
    'update_autoshare_rule',
    "Update an auto-share rule. `enabled: true` activates it — from then on, NEWLY-ingested matching activities that ended within the rule's max_age_hours are automatically published to the feed (never retroactively).",
    { id: z.string().uuid().describe('Rule ID'), ...updateAutoshareRuleBodySchema.shape },
    async ({ id, ...body }) => {
      const record = await updateAutoshareRule(user, id, autoshareRulePatchFromBody(body))
      if (!record) return errorResponse('Rule not found')
      return jsonResponse(serializeAutoshareRule(record))
    },
  )

  if (skip) {
    server.tool(
      'skip_autoshare',
      'Stop one activity (and the rest of its merge group) from ever being auto-shared, e.g. while its pending-share notification is up. It can still be shared by hand. Fails when the activity is already shared.',
      { ...skipAutoshareBodySchema.shape },
      async ({ activity_id }) => {
        const outcome = await skip(user, activity_id)
        if (outcome.status === 'not_found') return errorResponse('Activity not found')
        if (outcome.status === 'already_shared') return errorResponse('This activity is already shared')
        return jsonResponse({ activity_ids: outcome.activity_ids, success: true })
      },
    )
  }

  server.tool(
    'delete_autoshare_rule',
    'Delete an auto-share rule. Posts it already created stay on the feed.',
    { id: z.string().uuid().describe('Rule ID') },
    async ({ id }) => {
      const deleted = await deleteAutoshareRule(user, id)
      if (!deleted) return errorResponse('Rule not found')
      return jsonResponse({ deleted: true })
    },
  )

  server.tool(
    'preview_autoshare_rule',
    'Dry-run an auto-share rule: how many activities (merge groups) in the last 30 days WOULD have matched its predicate, ignoring max_age_hours. Creates and changes nothing — use before enabling.',
    { ...addAutoshareRuleBodySchema.shape },
    async (body) => {
      const tempRule: AutoshareRuleRecord = {
        ...autoshareRuleInputFromBody(body),
        created_at: new Date(),
        enabled: false,
        enabled_at: null,
        id: 'preview',
        updated_at: new Date(),
      }
      const wouldMatch = await previewAutoshareRule(user, tempRule, previewDeps, new Date())
      return jsonResponse({ sample_days: PREVIEW_SAMPLE_DAYS, would_match: wouldMatch })
    },
  )
}
