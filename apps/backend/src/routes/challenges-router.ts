import type { RequestHandler } from 'express'

/**
 * Challenges route group (owner + joiner facing).
 *
 * Handles: /challenges/*
 *
 * Hosts create/manage challenges (members live in the host's DB); any user joins
 * by URL (local shortcut when the host is this instance, else federated). The
 * host is always a member of their own challenge.
 */
import {
  type Challenge,
  type ChallengeMembersResponse,
  type ChallengeParticipationResponse,
  type ChallengeParticipationsResponse,
  type ChallengeResponse,
  type ChallengesResponse,
  type ChallengeStandingsResponse,
  type CreateChallengeBody,
  createChallengeBodySchema,
  type JoinChallengeBody,
  joinChallengeBodySchema,
  type UpdateChallengeBody,
  updateChallengeBodySchema,
} from '@aurboda/api-spec'

import {
  type ChallengeParticipationRecord,
  type ChallengeRecord,
  createChallenge,
  deleteChallenge,
  deleteChallengeParticipation,
  getChallengeById,
  listChallengeMembers,
  listChallengeParticipations,
  listChallenges,
  removeChallengeMember,
  updateChallenge,
  upsertChallengeMember,
} from '../db/index.ts'
import { JoinChallengeError, joinChallenge } from '../services/challenge-federation.ts'
import { specToApi } from '../services/challenge-spec.ts'
import { getChallengeStandings } from '../services/challenge-standings.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

const serializeParticipation = (p: ChallengeParticipationRecord) => ({
  challenge_url: p.challenge_url,
  created_at: p.created_at.toISOString(),
  end_ts: p.end_ts.toISOString(),
  host_identity: p.host_identity,
  id: p.id,
  name: p.name,
  spec: specToApi(p.spec),
  start_ts: p.start_ts.toISOString(),
  status: p.status,
  timezone: p.timezone,
})

const serialize = (record: ChallengeRecord, webHost: string, username: string): Challenge => ({
  created_at: record.created_at.toISOString(),
  end_ts: record.end_ts.toISOString(),
  id: record.id,
  is_public: record.is_public,
  name: record.name,
  share_url: buildShareUrl(webHost, username, record.slug),
  slug: record.slug,
  spec: specToApi(record.spec),
  start_ts: record.start_ts.toISOString(),
  timezone: record.timezone,
  updated_at: record.updated_at.toISOString(),
})

export const createChallengesRouter = (
  authMiddleware: RequestHandler,
  webHost: string,
  apiBaseUrl: string,
): TypedRouter => {
  const router = typedRouter()

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
        end_ts: new Date(req.body.end_ts),
        is_public: req.body.is_public,
        name: req.body.name,
        spec: {
          activity_type_id: req.body.spec.activity_type_id ?? null,
          aggregation: req.body.spec.aggregation,
          bucket_size: req.body.spec.bucket_size,
          pattern: req.body.spec.pattern ?? null,
          source_type: req.body.spec.source_type,
          unit: req.body.spec.unit,
        },
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
      const record = await updateChallenge(user, req.params.id, {
        end_ts: b.end_ts ? new Date(b.end_ts) : undefined,
        is_public: b.is_public,
        name: b.name,
        spec: b.spec
          ? {
              activity_type_id: b.spec.activity_type_id ?? null,
              aggregation: b.spec.aggregation,
              bucket_size: b.spec.bucket_size,
              pattern: b.spec.pattern ?? null,
              source_type: b.spec.source_type,
              unit: b.spec.unit,
            }
          : undefined,
        start_ts: b.start_ts ? new Date(b.start_ts) : undefined,
        timezone: b.timezone,
      })
      if (!record) return res.status(404).json({ error: 'Challenge not found', success: false })
      res.json({ challenge: serialize(record, webHost, user), success: true })
    },
  )

  router.delete<{ id: string }, ChallengeResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const deleted = await deleteChallenge(user, req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Challenge not found', success: false })
    res.json({ success: true })
  })

  router.get<{ id: string }, ChallengeStandingsResponse>(
    '/:id/standings',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const record = await getChallengeById(user, req.params.id)
      if (!record) return res.status(404).json({ error: 'Challenge not found', success: false })
      const members = await getChallengeStandings(user, record, { refresh: req.query.refresh === '1' })
      res.json({ members, success: true })
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

  // --- Participations (challenges I joined) ---

  router.get<Record<string, never>, ChallengeParticipationsResponse>(
    '/participations/mine',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const records = await listChallengeParticipations(user)
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
        res.json({ participation: serializeParticipation(participation), success: true })
      } catch (error) {
        if (error instanceof JoinChallengeError) {
          const status = error.kind === 'invalid_url' ? 400 : error.kind === 'not_found' ? 404 : 502
          return res.status(status).json({ error: error.message, success: false })
        }
        throw error
      }
    },
  )

  router.delete<{ id: string }, ChallengeParticipationResponse>(
    '/participations/:id',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const deleted = await deleteChallengeParticipation(user, req.params.id)
      if (!deleted) return res.status(404).json({ error: 'Participation not found', success: false })
      res.json({ success: true })
    },
  )

  return router
}
