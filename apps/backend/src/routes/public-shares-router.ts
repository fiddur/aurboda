/**
 * Public sharing routes (UNAUTHENTICATED).
 *
 * Handles `/public/:username/...` for both shared dashboards and challenges.
 * Never uses `req.user`; targets the owner's database directly by username
 * (validated against the same rules as signup). Dashboards return sanitized,
 * server-resolved data; challenges expose their spec (so other instances can
 * join), a public member list, and aggregated standings. Member data-endpoint
 * URLs are host-only secrets and never appear in any public response.
 */
import {
  type BaseResponse,
  type ChallengeStandingsResponse,
  type DashboardConfig,
  type PublicChallengeResponse,
  type PublicProfileResponse,
  type PublicSharedDashboardResponse,
  registerChallengeMemberBodySchema,
} from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  getChallengeBySlug,
  getChallengeMemberByIdentity,
  getSharedDashboardBySlug,
  listChallengeMembers,
  listPublicChallenges,
  listPublicSharedDashboards,
  upsertChallengeMember,
} from '../db/index.ts'
import { fetchMemberData } from '../services/challenge-federation.ts'
import { specToApi } from '../services/challenge-spec.ts'
import { getChallengeStandings } from '../services/challenge-standings.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'
import { resolveDashboardData } from '../services/shared-dashboard-data.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

/** Connecting to a non-existent user database fails with invalid_catalog_name. */
const isMissingDatabase = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '3D000'

/**
 * Strip viewer-useless / internal fields from a config before exposing it.
 * Quick links point into the owner's private app, so neutralize their hrefs.
 */
export const sanitizeConfig = (config: DashboardConfig): DashboardConfig => ({
  sections: config.sections.map((section) => ({
    ...section,
    widgets: section.widgets.map((widget) =>
      widget.type === 'quick_link' ? { ...widget, config: { ...widget.config, href: '#' } } : widget,
    ),
  })),
  version: config.version,
})

export const createPublicSharesRouter = (webHost: string): TypedRouter => {
  const router = typedRouter()

  router.get<{ username: string }, PublicProfileResponse>(
    '/public/:username/dashboards',
    async (req, res) => {
      const { username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Profile not found', success: false })
      }
      try {
        const [dashboards, challenges] = await Promise.all([
          listPublicSharedDashboards(username),
          listPublicChallenges(username),
        ])
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({
          challenges: challenges.map((c) => ({
            name: c.name,
            share_url: buildShareUrl(webHost, username, c.slug),
            slug: c.slug,
          })),
          dashboards: dashboards.map((r) => ({
            name: r.name,
            share_url: buildShareUrl(webHost, username, r.slug),
            slug: r.slug,
          })),
          profile_url: buildProfileUrl(webHost, username),
          success: true,
          username,
        })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Profile not found', success: false })
        }
        throw error
      }
    },
  )

  // Standings for a challenge (aggregated by the host). Slug-gated.
  router.get<{ username: string; slug: string }, ChallengeStandingsResponse>(
    '/public/:username/:slug/standings',
    async (req, res) => {
      const { slug, username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Challenge not found', success: false })
      }
      try {
        const challenge = await getChallengeBySlug(username, slug)
        if (!challenge) return res.status(404).json({ error: 'Challenge not found', success: false })
        // No `refresh` here: this endpoint is unauthenticated, so honoring it would
        // let anyone force N parallel outbound fetches. The TTL cache still keeps
        // standings reasonably fresh; the owner can force-refresh via the authed route.
        const members = await getChallengeStandings(username, challenge)
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({ members, success: true })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Challenge not found', success: false })
        }
        throw error
      }
    },
  )

  // Register-back: a joining instance adds itself as a remote member.
  router.post<{ username: string; slug: string }, BaseResponse>(
    '/public/:username/:slug/members',
    validateBody(registerChallengeMemberBodySchema),
    async (req, res) => {
      const { slug, username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Challenge not found', success: false })
      }
      try {
        const challenge = await getChallengeBySlug(username, slug)
        if (!challenge) return res.status(404).json({ error: 'Challenge not found', success: false })
        if (req.body.join_token !== challenge.join_token) {
          return res.status(403).json({ error: 'Invalid join token', success: false })
        }
        // Don't let an unauthenticated caller overwrite a local member (the host
        // or any same-instance member) by claiming their identity URL.
        const existing = await getChallengeMemberByIdentity(
          username,
          challenge.id,
          req.body.identity_base_url,
        )
        if (existing && existing.kind === 'local') {
          return res.status(409).json({ error: 'That identity is already a local member', success: false })
        }
        // Probe the member's data endpoint before accepting them (SSRF-guarded).
        try {
          await fetchMemberData(req.body.data_endpoint_url)
        } catch {
          return res.status(400).json({ error: 'Member data endpoint unreachable', success: false })
        }
        await upsertChallengeMember(username, challenge.id, {
          data_endpoint_url: req.body.data_endpoint_url,
          display_name: req.body.display_name,
          identity_base_url: req.body.identity_base_url,
          kind: 'remote',
        })
        res.json({ success: true })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Challenge not found', success: false })
        }
        throw error
      }
    },
  )

  // Resolve a slug to either a shared dashboard or a challenge.
  router.get<{ username: string; slug: string }, PublicSharedDashboardResponse | PublicChallengeResponse>(
    '/public/:username/:slug',
    async (req, res) => {
      const { slug, username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      try {
        const dashboard = await getSharedDashboardBySlug(username, slug)
        if (dashboard) {
          const widgetData = await resolveDashboardData(username, dashboard.config)
          res.setHeader('Cache-Control', 'public, max-age=60')
          return res.json({
            config: sanitizeConfig(dashboard.config),
            name: dashboard.name,
            profile_url: buildProfileUrl(webHost, username),
            share_url: buildShareUrl(webHost, username, dashboard.slug),
            success: true,
            type: 'dashboard',
            widget_data: widgetData,
          })
        }

        const challenge = await getChallengeBySlug(username, slug)
        if (challenge) {
          const members = await listChallengeMembers(username, challenge.id)
          res.setHeader('Cache-Control', 'public, max-age=60')
          return res.json({
            challenge: {
              end_ts: challenge.end_ts.toISOString(),
              host_identity: buildProfileUrl(webHost, username),
              is_public: challenge.is_public,
              join_token: challenge.join_token,
              members: members
                .filter((m) => m.status === 'active')
                .map((m) => ({ display_name: m.display_name, identity_base_url: m.identity_base_url })),
              name: challenge.name,
              profile_url: buildProfileUrl(webHost, username),
              share_url: buildShareUrl(webHost, username, challenge.slug),
              spec: specToApi(challenge.spec),
              start_ts: challenge.start_ts.toISOString(),
              timezone: challenge.timezone,
            },
            success: true,
            type: 'challenge',
          })
        }

        return res.status(404).json({ error: 'Not found', success: false })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        throw error
      }
    },
  )

  return router
}
