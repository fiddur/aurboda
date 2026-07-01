/**
 * Build challenge standings: each member's series + cumulative total.
 *
 * Local members are computed in-process; remote members are pulled from their
 * capability data endpoint with a short TTL cache (persisted on the member row).
 * A failed remote fetch falls back to last-known data flagged `stale`.
 */
import type { ChallengeStanding } from '@aurboda/api-spec'

import type { ChallengeRecord } from '../db/index.ts'

import { listChallengeMembers, updateChallengeMemberCache } from '../db/index.ts'
import { fetchMemberData } from './challenge-federation.ts'
import { resolveMemberSeries } from './challenge-spec.ts'

const CACHE_TTL_MS = 5 * 60 * 1000

export const getChallengeStandings = async (
  hostUser: string,
  challenge: ChallengeRecord,
  options: { refresh?: boolean } = {},
): Promise<ChallengeStanding[]> => {
  const members = await listChallengeMembers(hostUser, challenge.id)
  const now = Date.now()

  const standings = await Promise.all(
    // eslint-disable-next-line complexity -- one branch per member kind/cache state
    members.map(async (member): Promise<ChallengeStanding> => {
      const base = {
        display_name: member.display_name,
        identity_base_url: member.identity_base_url,
        status: member.status,
      }

      if (member.status === 'withdrawn') {
        return { ...base, buckets: [], last_updated: null, stale: false, total: 0 }
      }

      // Local member: compute directly from this instance's data.
      if (member.kind === 'local' && member.local_user) {
        const { buckets, total } = await resolveMemberSeries(
          member.local_user,
          challenge.spec,
          challenge.start_ts,
          challenge.end_ts,
        )
        return { ...base, buckets, last_updated: new Date().toISOString(), stale: false, total }
      }

      // Remote member: use the TTL cache unless refresh requested. We short-circuit
      // on freshness alone (not on cached_buckets) so a *failed* fetch is also cached
      // for the TTL — otherwise a member whose endpoint hangs (cached_buckets stays
      // null) would be re-fetched on every unauthenticated standings call.
      const fresh = member.last_fetched_at !== null && now - member.last_fetched_at.getTime() < CACHE_TTL_MS
      if (!options.refresh && fresh) {
        return {
          ...base,
          buckets: member.cached_buckets ?? [],
          last_updated: member.last_fetched_at?.toISOString() ?? null,
          stale: member.last_error !== null,
          total: member.cached_total ?? 0,
        }
      }

      if (!member.data_endpoint_url) {
        return {
          ...base,
          buckets: member.cached_buckets ?? [],
          last_updated: null,
          stale: true,
          total: member.cached_total ?? 0,
        }
      }

      try {
        const data = await fetchMemberData(member.data_endpoint_url)
        const buckets = data.buckets ?? []
        const total = data.total ?? buckets.reduce((s, b) => s + b.value, 0)
        await updateChallengeMemberCache(hostUser, member.id, { buckets, error: null, total })
        return { ...base, buckets, last_updated: new Date().toISOString(), stale: false, total }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await updateChallengeMemberCache(hostUser, member.id, {
          buckets: member.cached_buckets,
          error: message,
          total: member.cached_total,
        })
        return {
          ...base,
          buckets: member.cached_buckets ?? [],
          last_updated: member.last_fetched_at?.toISOString() ?? null,
          stale: true,
          total: member.cached_total ?? 0,
        }
      }
    }),
  )

  // Highest total first (cumulative leaderboard order).
  return standings.sort((a, b) => b.total - a.total)
}
