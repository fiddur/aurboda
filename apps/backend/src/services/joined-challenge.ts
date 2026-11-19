import {
  canonicalChallengeUrl,
  type ChallengeStanding,
  challengeStandingsResponseSchema,
  type JoinedChallengeResponse,
  parseChallengeUrl,
  type PublicChallenge,
  publicChallengeResponseSchema,
} from '@aurboda/api-spec'

import type { ChallengeParticipationRecord } from '../db/index.ts'

import { getParticipationById } from '../db/index.ts'
import { type ChallengeHost, discoverInstance } from './challenge-federation.ts'
import { serializeParticipation } from './challenge-spec.ts'
import { parseChallengePageUrl } from './challenge-thread.ts'
import { loadLocalPublicChallenge } from './public-challenge.ts'
import { safeFetchGet } from './safe-fetch.ts'

export interface HostChallengeView {
  challenge: PublicChallenge
  standings: ChallengeStanding[] | undefined
}

export interface JoinedChallengeDeps {
  getParticipation: (user: string, id: string) => Promise<ChallengeParticipationRecord | null>
  /** A challenge hosted here, read in-process the way its public page is. */
  loadLocal: (username: string, slug: string, webHost: string) => Promise<HostChallengeView | null>
  discover: (base: string) => Promise<ChallengeHost>
  fetchJson: (url: string) => Promise<unknown>
}

export const createJoinedChallengeDeps = (): JoinedChallengeDeps => ({
  discover: discoverInstance,
  fetchJson: async (url) => (await safeFetchGet(url)).data,
  getParticipation: getParticipationById,
  loadLocal: loadLocalPublicChallenge,
})

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

const publicPath = (apiBase: string, username: string, slug: string, rest = ''): string =>
  `${trimSlashes(apiBase)}/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}${rest}`

/** What another Aurboda server's public page shows; null when it is not one or cannot be read. */
const readRemoteHost = async (
  deps: Pick<JoinedChallengeDeps, 'discover' | 'fetchJson'>,
  challengeUrl: string,
): Promise<HostChallengeView | null> => {
  const canonical = canonicalChallengeUrl(challengeUrl)
  const parsed = canonical == null ? null : parseChallengeUrl(canonical)
  if (parsed == null) return null
  try {
    const username = decodeURIComponent(parsed.username)
    const slug = decodeURIComponent(parsed.slug)
    const host = await deps.discover(parsed.base)
    const [page, standings] = await Promise.all([
      deps.fetchJson(publicPath(host.apiBase, username, slug)),
      deps.fetchJson(publicPath(host.apiBase, username, slug, '/standings')),
    ])
    const challenge = publicChallengeResponseSchema.safeParse(page)
    const ranking = challengeStandingsResponseSchema.safeParse(standings)
    if (!challenge.success || challenge.data.type !== 'challenge' || challenge.data.challenge == null) {
      return null
    }
    if (!ranking.success) return null
    return { challenge: challenge.data.challenge, standings: ranking.data.members }
  } catch {
    return null
  }
}

/**
 * A challenge the user joined, for the page on their own server: the participation, a link to the
 * host's page and, when the host can be read, the challenge and standings as the host's page shows
 * them. A host that cannot be read leaves both out.
 */
export const getJoinedChallenge = async (
  deps: JoinedChallengeDeps,
  user: string,
  participationId: string,
  { webHost }: { webHost: string },
): Promise<{ ok: true; response: JoinedChallengeResponse } | { ok: false; status: 404; error: string }> => {
  const participation = await deps.getParticipation(user, participationId).catch(() => null)
  if (participation == null) return { error: 'Participation not found', ok: false, status: 404 }
  const local = parseChallengePageUrl(webHost, participation.challenge_url)
  const view =
    local == null
      ? await readRemoteHost(deps, participation.challenge_url)
      : await deps.loadLocal(local.username, local.slug, webHost).catch(() => null)
  return {
    ok: true,
    response: {
      ...(view == null
        ? {}
        : { challenge: view.challenge, ...(view.standings == null ? {} : { standings: view.standings }) }),
      host_page_url: participation.challenge_url,
      participation: serializeParticipation(participation),
      success: true,
    },
  }
}
