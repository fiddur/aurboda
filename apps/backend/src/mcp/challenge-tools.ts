/** Mirrors the REST `/challenges` capability. */
import {
  challengeCommentBodySchema,
  challengePostFollowBodySchema,
  challengePreviewQuerySchema,
  challengeThreadHideBodySchema,
  challengeThreadQuerySchema,
  createChallengeBodySchema,
  joinChallengeBodySchema,
  updateChallengeBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { ChallengeRecord } from '../db/index.ts'
import type { FeedDeliver } from '../routes/feed-router.ts'
import type { DiscoverChallenges } from '../services/challenge-discovery.ts'

import {
  createChallenge,
  deleteChallenge,
  deleteChallengeBanner,
  getChallengeById,
  listChallenges,
  upsertChallengeMember,
} from '../db/index.ts'
import { bannerUrlFor } from '../services/challenge-banner.ts'
import { joinChallenge, previewChallenge } from '../services/challenge-federation.ts'
import { listParticipationsFresh } from '../services/challenge-participation-sync.ts'
import { announcementPending } from '../services/challenge-results.ts'
import { serializeParticipation, specToApi, toSpecFields } from '../services/challenge-spec.ts'
import { createThreadDeps, type ThreadFederation } from '../services/challenge-thread-remote.ts'
import {
  addChallengeComment,
  readChallengeThread,
  setChallengePostFollowing,
  setChallengeThreadEntryHidden,
} from '../services/challenge-thread.ts'
import { LOCKED_MESSAGES, updateHostedChallenge } from '../services/challenge-update.ts'
import {
  createJoinedChallengeDeps,
  getJoinedChallenge,
  type JoinedChallengeDeps,
} from '../services/joined-challenge.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'
import { isPublicToVisibility, visibilityToIsPublic } from '../services/visibility.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const serialize = (record: ChallengeRecord, webHost: string | undefined, user: string) => ({
  announce_winner: record.announce_winner,
  announcement_pending: announcementPending(record, new Date()),
  banner_url: webHost ? bannerUrlFor(record, webHost, user) : undefined,
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
  deps: {
    webHost?: string
    apiBaseUrl?: string
    discoverChallenges?: DiscoverChallenges
    deliver?: FeedDeliver
    isAdmin?: (user: string) => Promise<boolean>
    threadFederation?: ThreadFederation
    joined?: JoinedChallengeDeps
  },
) => {
  const thread = deps.webHost
    ? createThreadDeps({ deliver: deps.deliver, webHost: deps.webHost, ...deps.threadFederation })
    : null
  const setHidden = async (challenge_url: string, entry_id: string, hidden: boolean) => {
    if (!thread) return errorResponse('Federation is not configured on this server')
    const result = await setChallengeThreadEntryHidden(
      thread,
      user,
      (await deps.isAdmin?.(user)) ?? false,
      challenge_url,
      entry_id,
      hidden,
    )
    return result.ok ? jsonResponse(result.entry) : errorResponse(result.error)
  }

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
    'Create a challenge you host. You are automatically a member. Times are ISO 8601 instants; pick start_ts at the first day midnight and end_ts at the midnight after the last day (in the given timezone). For an activity type with list items (strength sets), spec.measure scores a measure of each session instead of its duration, and filter_field/filter_value take it over one exercise: most push-ups in a month is measure total_reps with aggregation sum, the most push-ups in one set is measure max_reps with aggregation max (the best bucket wins), both with filter_field sets.exercise and filter_value Push-ups.',
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
    'Update a hosted challenge (name, spec, date range, visibility, announce_winner). Only provided fields change. The spec, dates and timezone are frozen once someone from another instance has joined: a different value is refused then, an unchanged one passes.',
    { id: z.string().uuid().describe('Challenge ID'), ...updateChallengeBodySchema.shape },
    async ({ id, ...body }) => {
      const result = await updateHostedChallenge(
        user,
        id,
        {
          announce_winner: body.announce_winner,
          end_ts: body.end_ts ? new Date(body.end_ts) : undefined,
          is_public: body.visibility === undefined ? undefined : visibilityToIsPublic(body.visibility),
          name: body.name,
          spec: body.spec ? toSpecFields(body.spec) : undefined,
          start_ts: body.start_ts ? new Date(body.start_ts) : undefined,
          timezone: body.timezone,
        },
        { webHost: deps.webHost },
      )
      if (result.status === 'not_found') return errorResponse('Challenge not found')
      if (result.status !== 'updated') return errorResponse(LOCKED_MESSAGES[result.status])
      return jsonResponse(serialize(result.record, deps.webHost, user))
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
    'remove_challenge_banner',
    'Remove the banner image of a hosted challenge, bringing back the themed card. Returns the updated challenge. To set a banner, upload it to a URL from create_upload_url with target challenge_banner.',
    { id: z.string().uuid().describe('Challenge ID') },
    async ({ id }) => {
      if (!(await getChallengeById(user, id))) return errorResponse('Challenge not found')
      await deleteChallengeBanner(user, id)
      const record = await getChallengeById(user, id)
      if (!record) return errorResponse('Challenge not found')
      return jsonResponse(serialize(record, deps.webHost, user))
    },
  )

  server.tool(
    'list_joined_challenges',
    'List challenges you joined, on this or another Aurboda instance: name, host, window and spec. A challenge hosted on this instance shows its current name, window and scoring; one hosted elsewhere refreshes its name from the host every few hours.',
    {},
    async () => {
      if (!deps.webHost) return errorResponse('Federation is not configured on this server')
      const records = await listParticipationsFresh(user, { webHost: deps.webHost })
      return jsonResponse(records.map(serializeParticipation))
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
        await thread?.remote?.afterJoin(user, participation)
        return jsonResponse({ joined: true, name: participation.name })
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Failed to join challenge')
      }
    },
  )

  server.tool(
    'get_joined_challenge',
    "A challenge you joined, by its participation id (from list_joined_challenges): your participation, the host's page URL and, when the host can be read, the challenge and its standings as the host's page shows them.",
    { participation_id: z.string().uuid().describe('Participation ID') },
    async ({ participation_id }) => {
      if (!deps.webHost) return errorResponse('Federation is not configured on this server')
      const result = await getJoinedChallenge(
        deps.joined ?? createJoinedChallengeDeps(),
        user,
        participation_id,
        {
          webHost: deps.webHost,
        },
      )
      return result.ok ? jsonResponse(result.response) : errorResponse(result.error)
    },
  )

  server.tool(
    'preview_challenge',
    'Read a challenge by its URL without joining it: name, host, window and what it counts (as join_challenge would join it). Works for challenges on this or another Aurboda instance.',
    { ...challengePreviewQuerySchema.shape },
    async ({ challenge_url }) => {
      if (!deps.webHost) return errorResponse('Federation is not configured on this server')
      try {
        return jsonResponse(await previewChallenge({ challengeUrl: challenge_url, webHost: deps.webHost }))
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : 'Failed to read the challenge')
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

  server.tool(
    'get_challenge_thread',
    'Read the comment thread of a challenge, by its page URL: one hosted on this instance, or one on another server that you joined (read from a copy pulled from the host at most five minutes ago). top-level entries (comments, share notes, the result post) newest first, 20 a page, each with its replies oldest first. Entries for `participants` show only to the host and members; hidden entries only to the host and admins. Your own entries carry `own_post_id` (edit or delete them with update_feed_post / delete_feed_post). For the host and members each top-level entry carries `following`: whether a reply under it notifies you (`challenge_reply`), by your own choice (set_challenge_post_follow), else because you wrote it or replied under it. `viewer` says your role and the audiences you may comment with. Pass `cursor` from `next_cursor` to page.',
    { ...challengeThreadQuerySchema.shape },
    async ({ challenge_url, cursor }) => {
      if (!thread) return errorResponse('Federation is not configured on this server')
      const result = await readChallengeThread(
        thread,
        user,
        challenge_url,
        cursor,
        (await deps.isAdmin?.(user)) ?? false,
      )
      if (!result.ok) return errorResponse(result.error)
      const { ok: _ok, ...view } = result
      return jsonResponse(view)
    },
  )

  server.tool(
    'add_challenge_comment',
    "Comment in a challenge's thread (by its page URL: one hosted on this instance, or one on another server that you joined, where the comment is delivered to the host and the other members), or reply to an entry with `in_reply_to_id`. `audience` `participants` is read by the host and members only and is all an unlisted challenge takes; `public` is open to anyone signed in on a public challenge. A reply is never wider than the entry it answers. The comment is a feed post of yours: edit or delete it with update_feed_post / delete_feed_post (its audience cannot change). Returns the new entry.",
    { ...challengeCommentBodySchema.shape },
    async (body) => {
      if (!thread) return errorResponse('Federation is not configured on this server')
      const result = await addChallengeComment(thread, user, body)
      return result.ok ? jsonResponse(result.entry) : errorResponse(result.error)
    },
  )

  server.tool(
    'set_challenge_post_follow',
    "Follow (`following` true) or stop following the replies under a top-level post of a challenge's thread (by the challenge's page URL: one hosted on this instance, or one on another server that you joined). A reply under a post you follow raises a `challenge_reply` notification; without a choice you follow the posts you wrote or replied under. The host and members only; a reply cannot be followed. Returns whether you now follow it.",
    {
      entry_id: z.string().uuid().describe('Top-level thread entry ID'),
      ...challengePostFollowBodySchema.shape,
    },
    async ({ challenge_url, entry_id, following }) => {
      if (!thread) return errorResponse('Federation is not configured on this server')
      const result = await setChallengePostFollowing(thread, user, challenge_url, entry_id, following)
      return result.ok ? jsonResponse({ following: result.following }) : errorResponse(result.error)
    },
  )

  server.tool(
    'hide_challenge_comment',
    "Hide an entry of a challenge's thread from everyone but the host (a hidden top-level entry hides its replies too). The host of the challenge or an admin only, on the host's own server.",
    { entry_id: z.string().uuid().describe('Thread entry ID'), ...challengeThreadHideBodySchema.shape },
    async ({ challenge_url, entry_id }) => setHidden(challenge_url, entry_id, true),
  )

  server.tool(
    'unhide_challenge_comment',
    "Show a hidden entry of a challenge's thread again. The host of the challenge or an admin only, on the host's own server.",
    { entry_id: z.string().uuid().describe('Thread entry ID'), ...challengeThreadHideBodySchema.shape },
    async ({ challenge_url, entry_id }) => setHidden(challenge_url, entry_id, false),
  )
}
