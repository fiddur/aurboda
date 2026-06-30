/**
 * MCP challenge tools — create/list/update/delete a hosted challenge and join
 * one by URL (local or federated). Mirrors the REST `/challenges` capability.
 */
import {
  createChallengeBodySchema,
  joinChallengeBodySchema,
  updateChallengeBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { ChallengeRecord, ChallengeSpecFields } from '../db/index.ts'

import {
  createChallenge,
  deleteChallenge,
  getChallengeById,
  listChallenges,
  updateChallenge,
  upsertChallengeMember,
} from '../db/index.ts'
import { joinChallenge } from '../services/challenge-federation.ts'
import { specToApi } from '../services/challenge-spec.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const toSpecFields = (spec: {
  source_type: 'metric' | 'activity_type'
  pattern?: string
  activity_type_id?: string
  aggregation: 'sum' | 'count'
  unit: string
  bucket_size: '1d' | '1w' | '1M'
}): ChallengeSpecFields => ({
  activity_type_id: spec.activity_type_id ?? null,
  aggregation: spec.aggregation,
  bucket_size: spec.bucket_size,
  pattern: spec.pattern ?? null,
  source_type: spec.source_type,
  unit: spec.unit,
})

const serialize = (record: ChallengeRecord, webHost: string | undefined, user: string) => ({
  created_at: record.created_at.toISOString(),
  end_ts: record.end_ts.toISOString(),
  id: record.id,
  is_public: record.is_public,
  name: record.name,
  share_url: webHost ? buildShareUrl(webHost, user, record.slug) : undefined,
  slug: record.slug,
  spec: specToApi(record.spec),
  start_ts: record.start_ts.toISOString(),
  timezone: record.timezone,
})

export const registerChallengeTools = (
  server: McpServer,
  user: string,
  deps: { webHost?: string; apiBaseUrl?: string },
) => {
  server.tool(
    'list_challenges',
    'List challenges you host (federated competitions on a metric or activity type over a date span).',
    {},
    async () => {
      const records = await listChallenges(user)
      return jsonResponse(records.map((r) => serialize(r, deps.webHost, user)))
    },
  )

  server.tool(
    'create_challenge',
    'Create a challenge you host. You are automatically a member. Times are ISO 8601 instants; pick start_ts at the first day midnight and end_ts at the midnight after the last day (in the given timezone).',
    { ...createChallengeBodySchema.shape },
    async (params) => {
      const record = await createChallenge(user, {
        end_ts: new Date(params.end_ts),
        is_public: params.is_public,
        name: params.name,
        spec: toSpecFields(params.spec),
        start_ts: new Date(params.start_ts),
        timezone: params.timezone,
      })
      if (deps.webHost) {
        await upsertChallengeMember(user, record.id, {
          display_name: user,
          identity_base_url: buildProfileUrl(deps.webHost, user),
          kind: 'local',
          local_user: user,
        })
      }
      return jsonResponse(serialize(record, deps.webHost, user))
    },
  )

  server.tool(
    'update_challenge',
    'Update a hosted challenge (name, spec, date range, visibility). Only provided fields change.',
    { id: z.string().uuid().describe('Challenge ID'), ...updateChallengeBodySchema.shape },
    async ({ id, ...body }) => {
      const record = await updateChallenge(user, id, {
        end_ts: body.end_ts ? new Date(body.end_ts) : undefined,
        is_public: body.is_public,
        name: body.name,
        spec: body.spec ? toSpecFields(body.spec) : undefined,
        start_ts: body.start_ts ? new Date(body.start_ts) : undefined,
        timezone: body.timezone,
      })
      if (!record) return errorResponse('Challenge not found')
      return jsonResponse(serialize(record, deps.webHost, user))
    },
  )

  server.tool(
    'delete_challenge',
    'Delete a hosted challenge by ID (removes its members too).',
    { id: z.string().uuid().describe('Challenge ID') },
    async ({ id }) => {
      const existing = await getChallengeById(user, id)
      if (!existing) return errorResponse('Challenge not found')
      await deleteChallenge(user, id)
      return jsonResponse({ deleted: true, id })
    },
  )

  server.tool(
    'join_challenge',
    'Join a challenge by its URL (e.g. https://aurboda.net/u/alice/abc123). Works for challenges on this or another Aurboda instance.',
    { ...joinChallengeBodySchema.shape },
    async ({ challenge_url }) => {
      if (!deps.webHost || !deps.apiBaseUrl)
        {return errorResponse('Federation is not configured on this server')}
      try {
        const participation = await joinChallenge({
          apiBaseUrl: deps.apiBaseUrl,
          challengeUrl: challenge_url,
          user,
          webHost: deps.webHost,
        })
        return jsonResponse({ joined: true, name: participation.name })
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Failed to join challenge')
      }
    },
  )
}
