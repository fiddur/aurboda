/**
 * MCP challenge tools — create/list/update/delete a hosted challenge, join one
 * by URL (local or federated), and discover open ones from followed peers.
 * Mirrors the REST `/challenges` capability.
 */
import type { ChallengeSpec } from '@aurboda/api-spec'

import {
  createChallengeBodySchema,
  joinChallengeBodySchema,
  updateChallengeBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { ChallengeRecord, ChallengeSpecFields } from '../db/index.ts'
import type { DiscoverChallenges } from '../services/challenge-discovery.ts'

import {
  createChallenge,
  deleteChallenge,
  getChallengeById,
  listChallenges,
  updateChallenge,
  upsertChallengeMember,
} from '../db/index.ts'
import { joinChallenge } from '../services/challenge-federation.ts'
import { announcementPending } from '../services/challenge-results.ts'
import { specToApi } from '../services/challenge-spec.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'
import { isPublicToVisibility, visibilityToIsPublic } from '../services/visibility.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const toSpecFields = (spec: ChallengeSpec): ChallengeSpecFields => ({
  activity_type_id: spec.activity_type_id ?? null,
  aggregation: spec.aggregation,
  bucket_size: spec.bucket_size,
  pattern: spec.pattern,
  source_type: spec.source_type,
  unit: spec.unit,
})

const serialize = (record: ChallengeRecord, webHost: string | undefined, user: string) => ({
  announce_winner: record.announce_winner,
  announcement_pending: announcementPending(record, new Date()),
  created_at: record.created_at.toISOString(),
  end_ts: record.end_ts.toISOString(),
  id: record.id,
  name: record.name,
  result_published_at: record.result_published_at?.toISOString() ?? null,
  share_url: webHost ? buildShareUrl(webHost, user, record.slug) : undefined,
  slug: record.slug,
  spec: specToApi(record.spec),
  start_ts: record.start_ts.toISOString(),
  timezone: record.timezone,
  visibility: isPublicToVisibility(record.is_public),
})

export const registerChallengeTools = (
  server: McpServer,
  user: string,
  deps: { webHost?: string; apiBaseUrl?: string; discoverChallenges?: DiscoverChallenges },
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
        announce_winner: params.announce_winner,
        end_ts: new Date(params.end_ts),
        is_public: visibilityToIsPublic(params.visibility),
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
    'Update a hosted challenge (name, spec, date range, visibility, announce_winner). Only provided fields change.',
    { id: z.string().uuid().describe('Challenge ID'), ...updateChallengeBodySchema.shape },
    async ({ id, ...body }) => {
      const record = await updateChallenge(user, id, {
        announce_winner: body.announce_winner,
        end_ts: body.end_ts ? new Date(body.end_ts) : undefined,
        is_public: body.visibility === undefined ? undefined : visibilityToIsPublic(body.visibility),
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
      if (!deps.webHost || !deps.apiBaseUrl) {
        return errorResponse('Federation is not configured on this server')
      }
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

  server.tool(
    'discover_challenges',
    'Open (ongoing or upcoming) public challenges hosted by people you follow — on this or any Aurboda instance — that you have not joined. Ongoing first, soonest to end. Join one with join_challenge and its share_url.',
    {},
    async () => {
      if (!deps.discoverChallenges) return errorResponse('Federation is not configured on this server')
      return jsonResponse(await deps.discoverChallenges(user))
    },
  )
}
