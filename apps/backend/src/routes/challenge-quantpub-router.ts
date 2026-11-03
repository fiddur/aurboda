/**
 * QuantPub Challenges over HTTP (`docs/fep/quantpub-challenges.md`), served
 * beside the older Aurboda protocol in `public-shares-router.ts`: the
 * challenge listing and document, HTTP join and leave, standings, and — on the
 * member side — the entry a host pulls. Unauthenticated like every
 * `/public/:username/...` route: the username selects the per-user database,
 * the slug (or the entry token) is the capability. Entry URLs are host-only
 * secrets and never appear in any response.
 */
import type { Response } from 'express'

import {
  type QuantChallengeDocument,
  type QuantChallengeEntry,
  type QuantChallengeJoinBody,
  quantChallengeJoinBodySchema,
  type QuantChallengeJoinResponse,
  type QuantChallengeLeaveBody,
  quantChallengeLeaveBodySchema,
  type QuantChallengeLeaveResponse,
  type QuantChallengeList,
  type QuantError,
  type QuantStandings,
} from '@aurboda/api-spec'

import type { ChallengeRecord } from '../db/index.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  getChallengeBySlug,
  getChallengeMemberByIdentity,
  getParticipationByToken,
  isMissingDatabase,
  listChallengeMembers,
  listPublicChallenges,
  removeChallengeMember,
  upsertChallengeMember,
} from '../db/index.ts'
import { fetchChallengeEntry, MAX_CHALLENGE_MEMBERS } from '../services/challenge-federation.ts'
import {
  buildChallengeDocument,
  buildChallengeListItem,
  buildEntryDocument,
  buildStandingsDocument,
  entryToMemberData,
  type HostContext,
  quantMetricForSpec,
} from '../services/challenge-quantpub.ts'
import { echoMismatchMessage, memberEchoMatches, resolveMemberSeries } from '../services/challenge-spec.ts'
import { getChallengeStandings } from '../services/challenge-standings.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export interface ChallengeQuantpubRouterConfig {
  webHost: string
  apiBaseUrl: string
  now?: () => Date
}

const notFound = (res: Response, error = 'Challenge not found') => res.status(404).json({ error })

/** Run a handler, answering 404 when the username has no database. */
const orMissing = async (res: Response, error: string, handler: () => Promise<unknown>): Promise<void> => {
  try {
    await handler()
  } catch (err) {
    if (isMissingDatabase(err)) {
      notFound(res, error)
      return
    }
    throw err
  }
}

const findChallenge = async (username: string, slug: string): Promise<ChallengeRecord | null> =>
  isValidUsername(username) ? getChallengeBySlug(username, slug) : null

export const createChallengeQuantpubRouter = (config: ChallengeQuantpubRouterConfig): TypedRouter => {
  const router = typedRouter()
  const now = config.now ?? (() => new Date())
  const ctx = (username: string): HostContext => ({
    apiBaseUrl: config.apiBaseUrl,
    now: now(),
    username,
    webHost: config.webHost,
  })

  router.get<{ username: string }, QuantChallengeList | QuantError>(
    '/public/:username/challenges',
    async (req, res) => {
      const { username } = req.params
      if (!isValidUsername(username)) return notFound(res, 'Profile not found')
      await orMissing(res, 'Profile not found', async () => {
        const challenges = await listPublicChallenges(username)
        const context = ctx(username)
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({ items: challenges.map((c) => buildChallengeListItem(c, context)), kind: 'challengeList' })
      })
    },
  )

  router.get<{ username: string; slug: string }, QuantChallengeDocument | QuantError>(
    '/public/:username/challenges/:slug',
    async (req, res) => {
      const { slug, username } = req.params
      await orMissing(res, 'Challenge not found', async () => {
        const challenge = await findChallenge(username, slug)
        if (!challenge) return notFound(res)
        const members = await listChallengeMembers(username, challenge.id)
        res.setHeader('Cache-Control', 'no-store')
        res.json(buildChallengeDocument(challenge, members, ctx(username)))
      })
    },
  )

  router.post<
    { username: string; slug: string },
    QuantChallengeJoinResponse | QuantError,
    QuantChallengeJoinBody
  >(
    '/public/:username/challenges/:slug/members',
    validateBody(quantChallengeJoinBodySchema),
    async (req, res) => {
      const { slug, username } = req.params
      await orMissing(res, 'Challenge not found', async () => {
        const challenge = await findChallenge(username, slug)
        if (!challenge) return notFound(res)
        if (req.body.joinToken !== challenge.join_token) {
          return res.status(403).json({ error: 'Invalid join token' })
        }
        if (challenge.end_ts.getTime() <= now().getTime()) {
          return res.status(409).json({ error: 'Challenge is closed' })
        }
        // `url` is an identity and its registered entry URL the proof: a token
        // holder may join, never take over someone who has.
        const existing = await getChallengeMemberByIdentity(username, challenge.id, req.body.url)
        if (existing?.kind === 'local') {
          return res.status(409).json({ error: 'That identity is already a local member' })
        }
        if (existing && req.body.currentEntryUrl !== existing.data_endpoint_url) {
          return res.status(409).json({ error: 'That identity is registered with another entry' })
        }
        if (!existing) {
          const members = await listChallengeMembers(username, challenge.id)
          if (members.length >= MAX_CHALLENGE_MEMBERS) {
            return res.status(409).json({ error: 'Challenge is full' })
          }
        }
        let entry: QuantChallengeEntry
        try {
          entry = await fetchChallengeEntry(req.body.entryUrl)
        } catch {
          return res.status(400).json({ error: 'Entry URL unreachable or not a challenge entry' })
        }
        const { key } = quantMetricForSpec(challenge.spec)
        if (entry.metric !== key || entry.scoring !== challenge.spec.aggregation) {
          return res.status(409).json({
            error: `The entry scores ${entry.metric} (${entry.scoring}); this challenge scores ${key} (${challenge.spec.aggregation})`,
          })
        }
        const data = entryToMemberData(entry, challenge)
        if (!memberEchoMatches(challenge.spec, data)) {
          return res.status(409).json({ error: echoMismatchMessage(challenge.spec, data) })
        }
        await upsertChallengeMember(username, challenge.id, {
          actor: req.body.actor ?? null,
          data_endpoint_url: req.body.entryUrl,
          display_name: req.body.name,
          identity_base_url: req.body.url,
          kind: 'remote',
        })
        res.json({ status: 'member' })
      })
    },
  )

  router.delete<
    { username: string; slug: string },
    QuantChallengeLeaveResponse | QuantError,
    QuantChallengeLeaveBody
  >(
    '/public/:username/challenges/:slug/members',
    validateBody(quantChallengeLeaveBodySchema),
    async (req, res) => {
      const { slug, username } = req.params
      await orMissing(res, 'Challenge not found', async () => {
        const challenge = await findChallenge(username, slug)
        if (!challenge) return notFound(res)
        const members = await listChallengeMembers(username, challenge.id)
        const member = members.find((m) => m.kind === 'remote' && m.data_endpoint_url === req.body.entryUrl)
        if (!member) return notFound(res, 'No member has that entry URL')
        await removeChallengeMember(username, challenge.id, member.id)
        res.json({ status: 'left' })
      })
    },
  )

  router.get<{ username: string; slug: string }, QuantStandings | QuantError>(
    '/public/:username/challenges/:slug/standings',
    async (req, res) => {
      const { slug, username } = req.params
      await orMissing(res, 'Challenge not found', async () => {
        const challenge = await findChallenge(username, slug)
        if (!challenge) return notFound(res)
        // No `refresh`: honouring it unauthenticated would let anyone force a fetch of every entry.
        const [standings, members] = await Promise.all([
          getChallengeStandings(username, challenge),
          listChallengeMembers(username, challenge.id),
        ])
        // The slug is an unlisted challenge's only gate, so its standings must not linger in caches.
        res.setHeader('Cache-Control', challenge.is_public ? 'public, max-age=60' : 'no-store')
        res.json(buildStandingsDocument(challenge, standings, members, ctx(username)))
      })
    },
  )

  router.get<{ username: string; token: string }, QuantChallengeEntry | QuantError>(
    '/public/:username/challenge-entries/:token',
    async (req, res) => {
      const { token, username } = req.params
      if (!isValidUsername(username)) return notFound(res, 'Not found')
      await orMissing(res, 'Not found', async () => {
        const participation = await getParticipationByToken(username, token)
        if (!participation || participation.status === 'withdrawn') return notFound(res, 'Not found')
        const series = await resolveMemberSeries(
          username,
          participation.spec,
          participation.start_ts,
          participation.end_ts,
          participation.timezone,
        )
        res.setHeader('Cache-Control', 'no-store')
        res.json(buildEntryDocument(participation, series))
      })
    },
  )

  return router
}
