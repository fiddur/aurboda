import type { ChallengeStandingsResponse, PublicChallenge } from '@aurboda/api-spec'

import type { ChallengeMemberRecord, ChallengeRecord } from '../db/index.ts'

import { getChallengeBySlug, listChallengeMembers } from '../db/index.ts'
import { bannerUrlFor } from './challenge-banner.ts'
import { effectiveBucketSize, specToApi } from './challenge-spec.ts'
import { getChallengeStandings } from './challenge-standings.ts'
import { buildProfileUrl, buildShareUrl } from './share-urls.ts'
import { isPublicToVisibility } from './visibility.ts'

/** A hosted challenge as its public page reads it (`GET /public/:username/:slug`). */
export const toPublicChallenge = (
  challenge: ChallengeRecord,
  members: readonly ChallengeMemberRecord[],
  webHost: string,
  username: string,
): PublicChallenge => ({
  banner_url: bannerUrlFor(challenge, webHost, username),
  effective_bucket_size: effectiveBucketSize(
    challenge.spec.bucket_size,
    challenge.start_ts,
    challenge.end_ts,
  ),
  end_ts: challenge.end_ts.toISOString(),
  host_identity: buildProfileUrl(webHost, username),
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
  visibility: isPublicToVisibility(challenge.is_public),
})

/** A hosted challenge's standings as its public page reads them (`GET /public/:username/:slug/standings`). */
export const publicChallengeStandings = async (
  username: string,
  challenge: ChallengeRecord,
): Promise<Required<Pick<ChallengeStandingsResponse, 'effective_bucket_size' | 'members'>>> => ({
  effective_bucket_size: effectiveBucketSize(
    challenge.spec.bucket_size,
    challenge.start_ts,
    challenge.end_ts,
  ),
  members: await getChallengeStandings(username, challenge),
})

/** A challenge hosted here and its standings, the way its public page shows them; null when there is none. */
export const loadLocalPublicChallenge = async (
  username: string,
  slug: string,
  webHost: string,
): Promise<{ challenge: PublicChallenge; standings: ChallengeStandingsResponse['members'] } | null> => {
  const challenge = await getChallengeBySlug(username, slug)
  if (challenge == null) return null
  const [members, standings] = await Promise.all([
    listChallengeMembers(username, challenge.id),
    publicChallengeStandings(username, challenge),
  ])
  return { challenge: toPublicChallenge(challenge, members, webHost, username), standings: standings.members }
}
