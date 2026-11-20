import type { RequestHandler } from 'express'

/**
 * Hosts create/manage challenges (members live in the host's DB); any user joins
 * by URL (local shortcut when the host is this instance, else federated). The
 * host is always a member of their own challenge.
 */
import {
  type Challenge,
  type ChallengeMembersResponse,
  type ChallengeParticipationResponse,
  type ChallengeParticipationsResponse,
  type ChallengePreviewQuery,
  challengePreviewQuerySchema,
  type ChallengePreviewResponse,
  type ChallengeResponse,
  type ChallengesResponse,
  type ChallengeStandingsResponse,
  type ChallengeCommentBody,
  challengeCommentBodySchema,
  type ChallengeThreadEntryResponse,
  type ChallengeThreadHideBody,
  challengeThreadHideBodySchema,
  type ChallengeThreadHideQuery,
  challengeThreadHideQuerySchema,
  type ChallengeThreadQuery,
  challengeThreadQuerySchema,
  type ChallengeThreadResponse,
  type CreateChallengeBody,
  createChallengeBodySchema,
  type DiscoverChallengesResponse,
  type JoinChallengeBody,
  joinChallengeBodySchema,
  type UpdateChallengeBody,
  updateChallengeBodySchema,
  type JoinedChallengeResponse,
} from '@aurboda/api-spec'

import type { DiscoverChallenges } from '../services/challenge-discovery.ts'
import type { FeedDeliver } from './feed-router.ts'

import { singleUpload } from '../api/upload.ts'
import {
  type ChallengeRecord,
  createChallenge,
  deleteChallenge,
  deleteChallengeBanner,
  getChallengeById,
  listChallengeMembers,
  listChallenges,
  removeChallengeMember,
  upsertChallengeBanner,
  upsertChallengeMember,
} from '../db/index.ts'
import { isAllowedImageType, processBanner } from '../services/avatar.ts'
import { bannerUrlFor } from '../services/challenge-banner.ts'
import {
  JoinChallengeError,
  joinChallenge,
  leaveChallenge,
  previewChallenge,
} from '../services/challenge-federation.ts'
import { listParticipationsFresh } from '../services/challenge-participation-sync.ts'
import { announcementPending } from '../services/challenge-results.ts'
import {
  effectiveBucketSize,
  serializeParticipation,
  specToApi,
  toSpecFields,
} from '../services/challenge-spec.ts'
import { getChallengeStandings } from '../services/challenge-standings.ts'
import { createThreadDeps, type ThreadFederation } from '../services/challenge-thread-remote.ts'
import {
  addChallengeComment,
  readChallengeThread,
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
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const bannerUpload = singleUpload({ field: 'banner', fields: 2, fileSize: 10 * 1024 * 1024 })

const joinErrorStatus = (error: JoinChallengeError): 400 | 404 | 502 =>
  error.kind === 'invalid_url' ? 400 : error.kind === 'not_found' ? 404 : 502

const serialize = (record: ChallengeRecord, webHost: string, username: string): Challenge => ({
  announce_winner: record.announce_winner,
  announcement_pending: announcementPending(record, new Date()),
  banner_url: bannerUrlFor(record, webHost, username),
  created_at: record.created_at.toISOString(),
  end_ts: record.end_ts.toISOString(),
  id: record.id,
  name: record.name,
  result_published_at: record.result_published_at?.toISOString() ?? null,
  share_url: buildShareUrl(webHost, username, record.slug),
  slug: record.slug,
  spec: specToApi(record.spec),
  start_ts: record.start_ts.toISOString(),
  timezone: record.timezone,
  updated_at: record.updated_at.toISOString(),
  visibility: isPublicToVisibility(record.is_public),
})

export const createChallengesRouter = (
  authMiddleware: RequestHandler,
  webHost: string,
  apiBaseUrl: string,
  discoverChallenges: DiscoverChallenges,
  threadOpts: {
    deliver?: FeedDeliver
    isAdmin?: (user: string) => Promise<boolean>
    federation?: ThreadFederation
    joined?: JoinedChallengeDeps
  } = {},
): TypedRouter => {
  const router = typedRouter()
  const thread = createThreadDeps({ deliver: threadOpts.deliver, webHost, ...threadOpts.federation })
  const isAdmin = threadOpts.isAdmin ?? (async () => false)
  const joined = threadOpts.joined ?? createJoinedChallengeDeps()

  router.get<Record<string, never>, ChallengesResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const records = await listChallenges(user)
    res.json({ challenges: records.map((r) => serialize(r, webHost, user)), success: true })
  })

  router.post<Record<string, never>, ChallengeResponse, CreateChallengeBody>(
    '/',
    authMiddleware,
    validateBody(createChallengeBodySchema),
    async (req, res) => {
      const user = req.user!
      const record = await createChallenge(user, {
        announce_winner: req.body.announce_winner,
        end_ts: new Date(req.body.end_ts),
        is_public: visibilityToIsPublic(req.body.visibility),
        name: req.body.name,
        spec: toSpecFields(req.body.spec),
        start_ts: new Date(req.body.start_ts),
        timezone: req.body.timezone,
      })
      // The host is always a member of their own challenge.
      await upsertChallengeMember(user, record.id, {
        display_name: user,
        identity_base_url: buildProfileUrl(webHost, user),
        kind: 'local',
        local_user: user,
      })
      res.json({ challenge: serialize(record, webHost, user), success: true })
    },
  )

  // These two before `/:id`, or "discover" and "preview" would be looked up as challenge ids.
  router.get<Record<string, never>, DiscoverChallengesResponse>(
    '/discover',
    authMiddleware,
    async (req, res) => {
      const result = await discoverChallenges(req.user!)
      res.json({ ...result, success: true })
    },
  )

  router.get<Record<string, never>, ChallengePreviewResponse, unknown, ChallengePreviewQuery>(
    '/preview',
    authMiddleware,
    validateQuery(challengePreviewQuerySchema),
    async (req, res) => {
      try {
        const challenge = await previewChallenge({ challengeUrl: req.query.challenge_url, webHost })
        res.json({ challenge, success: true })
      } catch (error) {
        if (error instanceof JoinChallengeError) {
          return res.status(joinErrorStatus(error)).json({ error: error.message, success: false })
        }
        throw error
      }
    },
  )

  // The comment thread, before `/:id` like the routes above.
  router.get<Record<string, never>, ChallengeThreadResponse, unknown, ChallengeThreadQuery>(
    '/thread',
    authMiddleware,
    validateQuery(challengeThreadQuerySchema),
    async (req, res) => {
      const user = req.user!
      const result = await readChallengeThread(
        thread,
        user,
        req.query.challenge_url,
        req.query.cursor,
        await isAdmin(user),
      )
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      const { ok: _ok, ...view } = result
      res.setHeader('Cache-Control', 'no-store')
      res.json({ ...view, success: true })
    },
  )

  router.post<Record<string, never>, ChallengeThreadEntryResponse, ChallengeCommentBody>(
    '/thread/comments',
    authMiddleware,
    validateBody(challengeCommentBodySchema),
    async (req, res) => {
      const result = await addChallengeComment(thread, req.user!, req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.status(201).json({ entry: result.entry, success: true })
    },
  )

  router.post<{ entryId: string }, ChallengeThreadEntryResponse, ChallengeThreadHideBody>(
    '/thread/entries/:entryId/hidden',
    authMiddleware,
    validateBody(challengeThreadHideBodySchema),
    async (req, res) => {
      const user = req.user!
      const result = await setChallengeThreadEntryHidden(
        thread,
        user,
        await isAdmin(user),
        req.body.challenge_url,
        req.params.entryId,
        true,
      )
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ entry: result.entry, success: true })
    },
  )

  router.delete<{ entryId: string }, ChallengeThreadEntryResponse, unknown, ChallengeThreadHideQuery>(
    '/thread/entries/:entryId/hidden',
    authMiddleware,
    validateQuery(challengeThreadHideQuerySchema),
    async (req, res) => {
      const user = req.user!
      const result = await setChallengeThreadEntryHidden(
        thread,
        user,
        await isAdmin(user),
        req.query.challenge_url,
        req.params.entryId,
        false,
      )
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ entry: result.entry, success: true })
    },
  )

  router.get<{ id: string }, ChallengeResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const record = await getChallengeById(user, req.params.id)
    if (!record) return res.status(404).json({ error: 'Challenge not found', success: false })
    res.json({ challenge: serialize(record, webHost, user), success: true })
  })

  router.put<{ id: string }, ChallengeResponse, UpdateChallengeBody>(
    '/:id',
    authMiddleware,
    validateBody(updateChallengeBodySchema),
    async (req, res) => {
      const user = req.user!
      const b = req.body
      const result = await updateHostedChallenge(
        user,
        req.params.id,
        {
          announce_winner: b.announce_winner,
          end_ts: b.end_ts ? new Date(b.end_ts) : undefined,
          is_public: b.visibility === undefined ? undefined : visibilityToIsPublic(b.visibility),
          name: b.name,
          spec: b.spec ? toSpecFields(b.spec) : undefined,
          start_ts: b.start_ts ? new Date(b.start_ts) : undefined,
          timezone: b.timezone,
        },
        { webHost },
      )
      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'Challenge not found', success: false })
      }
      if (result.status !== 'updated') {
        return res.status(409).json({ error: LOCKED_MESSAGES[result.status], success: false })
      }
      res.json({ challenge: serialize(result.record, webHost, user), success: true })
    },
  )

  router.delete<{ id: string }, ChallengeResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const deleted = await deleteChallenge(user, req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Challenge not found', success: false })
    res.json({ success: true })
  })

  router.post<{ id: string }, ChallengeResponse>(
    '/:id/banner',
    authMiddleware,
    bannerUpload,
    async (req, res) => {
      const user = req.user!
      const file = req.file
      if (!file) return res.status(400).json({ error: 'No file uploaded', success: false })
      if (!isAllowedImageType(file.mimetype)) {
        return res.status(400).json({
          error: `Unsupported file type: ${file.mimetype}. Allowed: PNG, JPEG, WebP, GIF`,
          success: false,
        })
      }
      if (!(await getChallengeById(user, req.params.id))) {
        return res.status(404).json({ error: 'Challenge not found', success: false })
      }

      let processed
      try {
        processed = await processBanner(file.buffer)
      } catch {
        return res.status(400).json({ error: 'Could not process image', success: false })
      }

      await upsertChallengeBanner(user, req.params.id, processed.content_type, processed.data)
      const record = await getChallengeById(user, req.params.id)
      if (!record) return res.status(404).json({ error: 'Challenge not found', success: false })
      res.json({ challenge: serialize(record, webHost, user), success: true })
    },
  )

  router.delete<{ id: string }, ChallengeResponse>('/:id/banner', authMiddleware, async (req, res) => {
    const user = req.user!
    if (!(await getChallengeById(user, req.params.id))) {
      return res.status(404).json({ error: 'Challenge not found', success: false })
    }
    await deleteChallengeBanner(user, req.params.id)
    const record = await getChallengeById(user, req.params.id)
    if (!record) return res.status(404).json({ error: 'Challenge not found', success: false })
    res.json({ challenge: serialize(record, webHost, user), success: true })
  })

  router.get<{ id: string }, ChallengeStandingsResponse>(
    '/:id/standings',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const record = await getChallengeById(user, req.params.id)
      if (!record) return res.status(404).json({ error: 'Challenge not found', success: false })
      const members = await getChallengeStandings(user, record, { refresh: req.query.refresh === '1' })
      res.json({
        effective_bucket_size: effectiveBucketSize(record.spec.bucket_size, record.start_ts, record.end_ts),
        members,
        success: true,
      })
    },
  )

  router.get<{ id: string }, ChallengeMembersResponse>('/:id/members', authMiddleware, async (req, res) => {
    const user = req.user!
    const members = await listChallengeMembers(user, req.params.id)
    res.json({
      members: members.map((m) => ({
        display_name: m.display_name,
        id: m.id,
        identity_base_url: m.identity_base_url,
        status: m.status,
      })),
      success: true,
    })
  })

  router.delete<{ id: string; memberId: string }, ChallengeResponse>(
    '/:id/members/:memberId',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const removed = await removeChallengeMember(user, req.params.id, req.params.memberId)
      if (!removed) return res.status(404).json({ error: 'Member not found', success: false })
      res.json({ success: true })
    },
  )

  // Participations: challenges this user joined.

  router.get<Record<string, never>, ChallengeParticipationsResponse>(
    '/participations/mine',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const records = await listParticipationsFresh(user, { webHost })
      res.json({ participations: records.map(serializeParticipation), success: true })
    },
  )

  router.post<Record<string, never>, ChallengeParticipationResponse, JoinChallengeBody>(
    '/join',
    authMiddleware,
    validateBody(joinChallengeBodySchema),
    async (req, res) => {
      const user = req.user!
      try {
        const participation = await joinChallenge({
          apiBaseUrl,
          challengeUrl: req.body.challenge_url,
          user,
          webHost,
        })
        await thread.remote?.afterJoin(user, participation)
        res.json({ participation: serializeParticipation(participation), success: true })
      } catch (error) {
        if (error instanceof JoinChallengeError) {
          return res.status(joinErrorStatus(error)).json({ error: error.message, success: false })
        }
        throw error
      }
    },
  )

  router.get<{ id: string }, JoinedChallengeResponse>(
    '/participations/:id',
    authMiddleware,
    async (req, res) => {
      const result = await getJoinedChallenge(joined, req.user!, req.params.id, { webHost })
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json(result.response)
    },
  )

  router.delete<{ id: string }, ChallengeParticipationResponse>(
    '/participations/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const deleted = await leaveChallenge(user, req.params.id, { apiBaseUrl, webHost })
      if (!deleted) return res.status(404).json({ error: 'Participation not found', success: false })
      res.json({ success: true })
    },
  )

  return router
}
