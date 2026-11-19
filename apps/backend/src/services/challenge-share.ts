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
import type { ChallengeShare, ShareChallengeBody } from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/index.ts'
import type { FeedDeliver } from '../routes/feed-router.ts'

import { createChallengePost, getChallengeById, getParticipationById } from '../db/index.ts'
import {
  type ChallengeThreadDeps,
  followPostInThread,
  hostedChallengeObjectUri,
  syncThreadEntryForPost,
} from './challenge-thread.ts'
import { normalizeFeedMessage } from './feed.ts'
import { CHALLENGE_KIND_TAG, resolvePostTags } from './post-tags.ts'
import { buildChallengeObjectUrl, buildShareUrl } from './share-urls.ts'

export interface ChallengeShareSource {
  challenge_id?: string
  participation_id?: string
}

export type ResolvedChallengeShare =
  /** `challenge_uri`: the challenge's object id when it is hosted on this instance (its thread). */
  | { ok: true; challenge: ChallengeShare; challenge_uri: string | null }
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
    return {
      challenge: { name: challenge.name, url: buildShareUrl(webHost, user, challenge.slug) },
      challenge_uri: buildChallengeObjectUrl(webHost, user, challenge.slug),
      ok: true,
    }
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
      challenge_uri: webHost ? await hostedChallengeObjectUri(webHost, participation.challenge_url) : null,
      ok: true,
    }
  }
  // Unreachable after the exactly-one guard; keeps the return type total.
  return { error: 'Provide exactly one of challenge_id or participation_id', ok: false, status: 400 }
}

/**
 * Publish a challenge share (REST `POST /feed/challenges` and MCP `share_challenge`): the post, its
 * federation, and, for a challenge hosted here, its entry in the challenge's thread.
 */
export const publishChallengeShare = async (
  user: string,
  body: ShareChallengeBody,
  deps: {
    webHost: string | undefined
    deliver?: Pick<FeedDeliver, 'createdChallenge'>
    thread?: ChallengeThreadDeps
  },
): Promise<{ ok: true; record: FeedPostRecord } | { ok: false; error: string; status: 400 | 404 | 503 }> => {
  const resolved = await resolveChallengeShare(user, body, deps.webHost)
  if (!resolved.ok) return resolved
  const message = normalizeFeedMessage(body.message) ?? null
  const record = await createChallengePost(user, {
    challenge: resolved.challenge,
    challenge_uri: resolved.challenge_uri,
    include_chart: body.include_chart,
    message,
    tags: await resolvePostTags(user, { explicit: body.tags, kindTag: CHALLENGE_KIND_TAG, texts: [message] }),
    visibility: body.visibility,
  })
  deps.deliver?.createdChallenge(user, record)
  const thread = deps.thread
  if (thread != null && record.challenge_uri != null) {
    await followPostInThread(() => syncThreadEntryForPost(thread, user, record), record.id)
  }
  return { ok: true, record }
}
