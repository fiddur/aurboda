/**
 * Resolve what a challenge-share post links to (#994) — shared by the REST
 * `POST /feed/challenges` route and the MCP `share_challenge` tool (parity).
 *
 * The name/URL are resolved server-side from the user's own challenge (its
 * canonical public share URL) or from a joined challenge's stored
 * participation (the host's URL + identity) — never client-supplied, so a post
 * can never carry a spoofed link. Deliberately excludes join tokens and
 * standings data.
 */
import type { ChallengeShare } from '@aurboda/api-spec'

import { getChallengeById, getParticipationById } from '../db/index.ts'
import { buildShareUrl } from './share-urls.ts'

export interface ChallengeShareSource {
  challenge_id?: string
  participation_id?: string
}

export type ResolvedChallengeShare =
  | { ok: true; challenge: ChallengeShare }
  | { ok: false; error: string; status: 400 | 404 | 503 }

/** Resolve the share payload from exactly one of `challenge_id`/`participation_id`. */
export const resolveChallengeShare = async (
  user: string,
  source: ChallengeShareSource,
  webHost: string | undefined,
): Promise<ResolvedChallengeShare> => {
  const { challenge_id, participation_id } = source
  if ((challenge_id == null) === (participation_id == null)) {
    return { error: 'Provide exactly one of challenge_id or participation_id', ok: false, status: 400 }
  }
  if (challenge_id != null) {
    if (!webHost) return { error: 'Sharing is not available', ok: false, status: 503 }
    const challenge = await getChallengeById(user, challenge_id)
    if (!challenge) return { error: 'Challenge not found', ok: false, status: 404 }
    return { challenge: { name: challenge.name, url: buildShareUrl(webHost, user, challenge.slug) }, ok: true }
  }
  if (participation_id != null) {
    const participation = await getParticipationById(user, participation_id)
    if (!participation) {
      return { error: 'Challenge participation not found', ok: false, status: 404 }
    }
    return {
      challenge: {
        host_identity: participation.host_identity,
        name: participation.name,
        url: participation.challenge_url,
      },
      ok: true,
    }
  }
  // Unreachable after the exactly-one guard; keeps the return type total.
  return { error: 'Provide exactly one of challenge_id or participation_id', ok: false, status: 400 }
}
