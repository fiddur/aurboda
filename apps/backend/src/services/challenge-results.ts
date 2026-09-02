/**
 * Challenge completion → winner announcement.
 *
 * When a hosted challenge's window closes, the host's instance posts the final
 * standings to the host's feed as a `challenge` post carrying a `result`
 * payload (the podium, winners tagged with a `Mention`) — unless the host
 * switched `announce_winner` off for that challenge. The sweep runs on a
 * schedule (see `challenge-results-queue.ts`) over every user's hosted
 * challenges; the pure pieces (result computation, post shape, the sweep loop
 * with injected I/O) live here so they are unit-testable.
 *
 * The announcement waits `RESULT_GRACE_MS` after `end_ts` so members' last-day
 * data has had time to sync before the podium is frozen.
 */
import type {
  ChallengeResult,
  ChallengeResultEntry,
  ChallengeStanding,
  FeedVisibility,
} from '@aurboda/api-spec'

import type { ChallengePostInput, ChallengeRecord, FeedPostRecord } from '../db/index.ts'

import { auditError } from './audit-log.ts'
import { buildShareUrl } from './share-urls.ts'

/** How long after the window closes the result is published (lets late syncs land). */
export const RESULT_GRACE_MS = 6 * 60 * 60 * 1000

/**
 * A challenge that ended longer ago than this is never announced. The column
 * migration backfills `announce_winner = true` onto every existing challenge, so
 * without this bound the first sweep after deploy would announce every challenge
 * that ever finished — feed posts, follower fan-out and winner-inbox deliveries
 * that can't be recalled. It also stops a long-skipped challenge (sweep down,
 * remote member unreachable for days) from surfacing as stale news.
 */
export const MAX_ANNOUNCE_AGE_MS = 3 * 24 * 60 * 60 * 1000

/** Bounded blast radius per sweep: a bug or an unexpectedly wide window can only leak this many posts. */
export const MAX_ANNOUNCEMENTS_PER_SWEEP = 20

/**
 * A member whose instance couldn't be reached (`stale`: last-known or zero
 * data) holds the announcement back — a podium must not freeze on a cached
 * total because a winner's server was down at the 6-hour mark. But an instance
 * that is gone for good must not block the result forever either: once the
 * challenge has been over this long, last-known data is accepted.
 */
export const STALE_ACCEPT_AFTER_MS = 24 * 60 * 60 * 1000

/** True when an active member's standing is last-known/zero data from a failed fetch. */
export const hasStaleMember = (standings: ChallengeStanding[]): boolean =>
  standings.some((s) => s.status === 'active' && s.stale)

/** Everyone ranked 1–3 makes the podium (a tie for a place keeps all of them). */
const PODIUM_MAX_RANK = 3
/** Hard cap on podium entries so a mass tie can't bloat the post. */
const PODIUM_MAX_ENTRIES = 10

/**
 * Freeze the final standings into a result: active members only, competition
 * ranking (equal totals share a rank; the next rank skips, e.g. 1, 1, 3), and
 * only members who actually scored on the podium. Returns null when nobody
 * scored — there is no winner to announce.
 */
export const computeChallengeResult = (
  standings: ChallengeStanding[],
  unit: string,
): ChallengeResult | null => {
  const active = standings.filter((s) => s.status === 'active')
  const scored = active.filter((s) => s.total > 0).sort((a, b) => b.total - a.total)
  if (scored.length === 0) return null
  const podium: ChallengeResultEntry[] = []
  for (const standing of scored) {
    const rank = 1 + scored.filter((other) => other.total > standing.total).length
    if (rank > PODIUM_MAX_RANK || podium.length >= PODIUM_MAX_ENTRIES) break
    podium.push({
      display_name: standing.display_name,
      identity_base_url: standing.identity_base_url,
      rank,
      total: standing.total,
    })
  }
  return { member_count: active.length, podium, unit }
}

/** The winners of a result: every rank-1 entry (several on a tie). */
export const challengeWinners = (result: ChallengeResult): ChallengeResultEntry[] =>
  result.podium.filter((entry) => entry.rank === 1)

/**
 * A public challenge announces publicly. An unlisted challenge is link-only by
 * the host's choice, and even an `unlisted` post is world-readable (`as:Public`
 * in cc, on the outbox) and would publish the slug that hands out the join
 * token + member list — so its result goes to followers only. The tagged
 * winners still get it delivered to their inbox either way.
 */
export const resultPostVisibility = (challenge: ChallengeRecord): FeedVisibility =>
  challenge.is_public ? 'public' : 'followers'

/** The completion post: the same link payload a manual share carries, plus the frozen result. */
export const buildChallengeResultPost = (
  challenge: ChallengeRecord,
  result: ChallengeResult,
  webHost: string,
  user: string,
): ChallengePostInput => ({
  challenge: { name: challenge.name, result, url: buildShareUrl(webHost, user, challenge.slug) },
  message: null,
  visibility: resultPostVisibility(challenge),
})

export interface ChallengeResultsDeps {
  /** Every user whose hosted challenges the sweep should visit. */
  listUsers: () => Promise<string[]>
  /** A user's hosted challenges that ended within the window and still await their announcement. */
  listAwaiting: (user: string, window: { endedAfter: Date; endedBefore: Date }) => Promise<ChallengeRecord[]>
  /** Fresh standings for a challenge (remote members re-fetched). */
  standings: (user: string, challenge: ChallengeRecord) => Promise<ChallengeStanding[]>
  /** Mark the challenge announced; false when another sweep already claimed it. */
  claim: (user: string, challengeId: string) => Promise<boolean>
  createPost: (user: string, input: ChallengePostInput) => Promise<FeedPostRecord>
  /** Fan the post out to followers + the tagged winners (fire-and-forget). */
  deliver: (user: string, post: FeedPostRecord) => void
  webHost: string
  now?: () => Date
}

/**
 * One sweep: for every user, announce each hosted challenge that closed at
 * least `RESULT_GRACE_MS` ago and no more than `MAX_ANNOUNCE_AGE_MS` ago — no
 * retroactive announcements, ever. The claim happens before the post is created
 * so a challenge is announced at most once even if sweeps overlap. A challenge
 * with a stale member (a remote fetch failed — `getChallengeStandings` never
 * throws, it flags) stays pending and is retried next sweep, until
 * `STALE_ACCEPT_AFTER_MS` after its end. A challenge nobody scored in is claimed
 * without a post (nothing to announce, and no point re-checking it forever). At
 * most `MAX_ANNOUNCEMENTS_PER_SWEEP` posts per run; anything beyond waits for
 * the next tick. Returns how many posts were published.
 */
export const publishFinishedChallengeResults = async (deps: ChallengeResultsDeps): Promise<number> => {
  const now = deps.now?.() ?? new Date()
  const window = {
    endedAfter: new Date(now.getTime() - MAX_ANNOUNCE_AGE_MS),
    endedBefore: new Date(now.getTime() - RESULT_GRACE_MS),
  }
  let published = 0
  for (const user of await deps.listUsers()) {
    if (published >= MAX_ANNOUNCEMENTS_PER_SWEEP) break
    let awaiting: ChallengeRecord[]
    try {
      awaiting = await deps.listAwaiting(user, window)
    } catch (error) {
      auditError(user, 'data', 'Challenge result sweep could not list challenges', { error: String(error) })
      continue
    }
    for (const challenge of awaiting) {
      if (published >= MAX_ANNOUNCEMENTS_PER_SWEEP) break
      try {
        const standings = await deps.standings(user, challenge)
        const staleAcceptable = now.getTime() - challenge.end_ts.getTime() >= STALE_ACCEPT_AFTER_MS
        if (hasStaleMember(standings) && !staleAcceptable) continue
        const result = computeChallengeResult(standings, challenge.spec.unit)
        if (!(await deps.claim(user, challenge.id))) continue
        if (result == null) continue
        const post = await deps.createPost(
          user,
          buildChallengeResultPost(challenge, result, deps.webHost, user),
        )
        deps.deliver(user, post)
        published++
      } catch (error) {
        auditError(user, 'data', 'Challenge result announcement failed', {
          challenge_id: challenge.id,
          error: String(error),
        })
      }
    }
  }
  return published
}
