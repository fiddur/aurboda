import {
  canonicalChallengeUrl,
  challengeNameSchema,
  type ParsedChallengeUrl,
  parseChallengeUrl,
} from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  type ChallengeMemberRecord,
  type ChallengeParticipationRecord,
  type ChallengeParticipationSnapshotPatch,
  type ChallengeRecord,
  getChallengeBySlug,
  listChallengeMembers,
  listChallengeParticipations,
  updateChallengeParticipationSnapshot,
} from '../db/index.ts'
import { discoverInstance, fetchChallengeDocument, fetchChallengeSpec } from './challenge-federation.ts'
import { sameSpec } from './challenge-spec.ts'
import { buildShareUrl } from './share-urls.ts'

export const HOST_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
export const MAX_HOST_CHECKS_PER_LIST = 5

type HostSnapshot = Pick<ChallengeRecord, 'end_ts' | 'name' | 'spec' | 'start_ts' | 'timezone'>

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** What the participation's copy lacks of the host's challenge; null when it is in line. */
export const participationDrift = (
  participation: ChallengeParticipationRecord,
  challenge: HostSnapshot,
): ChallengeParticipationSnapshotPatch | null => {
  const patch: ChallengeParticipationSnapshotPatch = {
    ...(participation.name === challenge.name ? {} : { name: challenge.name }),
    ...(sameSpec(participation.spec, challenge.spec) ? {} : { spec: challenge.spec }),
    ...(participation.start_ts.getTime() === challenge.start_ts.getTime()
      ? {}
      : { start_ts: challenge.start_ts }),
    ...(participation.end_ts.getTime() === challenge.end_ts.getTime() ? {} : { end_ts: challenge.end_ts }),
    ...(participation.timezone === challenge.timezone ? {} : { timezone: challenge.timezone }),
  }
  return Object.keys(patch).length === 0 ? null : patch
}

export interface PushDeps {
  listChallengeMembers: (user: string, challengeId: string) => Promise<ChallengeMemberRecord[]>
  listChallengeParticipations: (user: string) => Promise<ChallengeParticipationRecord[]>
  updateChallengeParticipationSnapshot: typeof updateChallengeParticipationSnapshot
}

// Wrapped so the db module is read on call, not at import: tests that mock it whole still load this.
const defaultPushDeps: PushDeps = {
  listChallengeMembers: (user, challengeId) => listChallengeMembers(user, challengeId),
  listChallengeParticipations: (user) => listChallengeParticipations(user),
  updateChallengeParticipationSnapshot: (user, id, patch) =>
    updateChallengeParticipationSnapshot(user, id, patch),
}

/**
 * Bring every local member's participation in line with the host's challenge after an update.
 * Best effort: a member whose database fails is logged and skipped, never failing the host.
 */
export const pushChallengeToLocalMembers = async (
  host: string,
  challenge: ChallengeRecord,
  webHost: string,
  deps: PushDeps = defaultPushDeps,
): Promise<void> => {
  const challengeUrl = canonicalChallengeUrl(buildShareUrl(webHost, host, challenge.slug))
  if (challengeUrl === null) return
  let members: ChallengeMemberRecord[]
  try {
    members = await deps.listChallengeMembers(host, challenge.id)
  } catch (error) {
    console.warn(`⚠️ Challenge sync: could not list members of ${challenge.id}:`, errorMessage(error))
    return
  }
  const locals = members.flatMap((m) => (m.kind === 'local' && m.local_user ? [m.local_user] : []))
  await Promise.all(
    locals.map(async (member) => {
      try {
        const participation = (await deps.listChallengeParticipations(member)).find(
          (p) => canonicalChallengeUrl(p.challenge_url) === challengeUrl,
        )
        if (!participation) return
        const patch = participationDrift(participation, challenge)
        if (patch) await deps.updateChallengeParticipationSnapshot(member, participation.id, patch)
      } catch (error) {
        console.warn(`⚠️ Challenge sync: could not update a member of ${challenge.id}:`, errorMessage(error))
      }
    }),
  )
}

export type HostChallengeSnapshot = Pick<HostSnapshot, 'name'> & {
  start_ts: string
  end_ts: string
  timezone: string
}

/** The remote host's current challenge, read the way a join reads it. */
export const fetchRemoteChallengeSnapshot = async (
  parsed: ParsedChallengeUrl,
): Promise<HostChallengeSnapshot> => {
  const host = await discoverInstance(parsed.base)
  if (host.kind === 'quantpub') {
    const doc = await fetchChallengeDocument(host.apiBase, parsed.username, parsed.slug)
    return { end_ts: doc.endTime, name: doc.name, start_ts: doc.startTime, timezone: doc.timezone }
  }
  const challenge = await fetchChallengeSpec(host.apiBase, parsed.username, parsed.slug)
  return {
    end_ts: challenge.end_ts,
    name: challenge.name,
    start_ts: challenge.start_ts,
    timezone: challenge.timezone,
  }
}

export interface ListFreshDeps {
  listChallengeParticipations: (user: string) => Promise<ChallengeParticipationRecord[]>
  getChallengeBySlug: (user: string, slug: string) => Promise<ChallengeRecord | null>
  updateChallengeParticipationSnapshot: typeof updateChallengeParticipationSnapshot
  fetchRemoteChallenge: (parsed: ParsedChallengeUrl) => Promise<HostChallengeSnapshot>
  now: () => Date
  /** Starts a task the list response does not wait for; the task never rejects. */
  background: (task: () => Promise<void>) => void
}

const defaultListDeps: ListFreshDeps = {
  background: (task) => {
    void task()
  },
  fetchRemoteChallenge: fetchRemoteChallengeSnapshot,
  getChallengeBySlug: (user, slug) => getChallengeBySlug(user, slug),
  listChallengeParticipations: (user) => listChallengeParticipations(user),
  now: () => new Date(),
  updateChallengeParticipationSnapshot: (user, id, patch) =>
    updateChallengeParticipationSnapshot(user, id, patch),
}

const parsedUrl = (participation: ChallengeParticipationRecord): ParsedChallengeUrl | null => {
  const canonical = canonicalChallengeUrl(participation.challenge_url)
  return canonical === null ? null : parseChallengeUrl(canonical)
}

const repairLocal = async (
  user: string,
  participation: ChallengeParticipationRecord,
  parsed: ParsedChallengeUrl,
  deps: ListFreshDeps,
): Promise<ChallengeParticipationRecord> => {
  if (!isValidUsername(parsed.username)) return participation
  try {
    const challenge = await deps.getChallengeBySlug(parsed.username, parsed.slug)
    if (!challenge) return participation
    const patch = participationDrift(participation, challenge)
    if (!patch) return participation
    return (await deps.updateChallengeParticipationSnapshot(user, participation.id, patch)) ?? participation
  } catch (error) {
    console.warn(
      `⚠️ Challenge sync: could not repair participation ${participation.id}:`,
      errorMessage(error),
    )
    return participation
  }
}

const refreshRemoteName = async (
  user: string,
  participation: ChallengeParticipationRecord,
  parsed: ParsedChallengeUrl,
  deps: ListFreshDeps,
): Promise<void> => {
  let name: string | null = null
  try {
    name = (await deps.fetchRemoteChallenge(parsed)).name
      .trim()
      .slice(0, challengeNameSchema.maxLength ?? undefined)
  } catch (error) {
    console.warn(
      `⚠️ Challenge sync: host of participation ${participation.id} did not answer:`,
      errorMessage(error),
    )
  }
  try {
    await deps.updateChallengeParticipationSnapshot(user, participation.id, {
      host_checked_at: deps.now(),
      ...(name && name !== participation.name ? { name } : {}),
    })
  } catch (error) {
    console.warn(
      `⚠️ Challenge sync: could not record host check for ${participation.id}:`,
      errorMessage(error),
    )
  }
}

const isStale = (participation: ChallengeParticipationRecord, now: Date): boolean =>
  participation.host_checked_at === null ||
  now.getTime() - participation.host_checked_at.getTime() >= HOST_CHECK_INTERVAL_MS

/**
 * The user's participations, in line with their hosts: one hosted on this instance is repaired
 * from the host's challenge before it is returned; one hosted elsewhere has its name refreshed in
 * the background when the host was not asked recently (its window and spec stay as joined).
 */
export const listParticipationsFresh = async (
  user: string,
  { webHost }: { webHost: string },
  deps: ListFreshDeps = defaultListDeps,
): Promise<ChallengeParticipationRecord[]> => {
  const participations = await deps.listChallengeParticipations(user)
  const ourBase = trimSlashes(webHost)
  const now = deps.now()
  let refreshes = 0
  return Promise.all(
    participations.map(async (participation) => {
      const parsed = parsedUrl(participation)
      if (!parsed) return participation
      if (parsed.base === ourBase) return repairLocal(user, participation, parsed, deps)
      if (refreshes < MAX_HOST_CHECKS_PER_LIST && isStale(participation, now)) {
        refreshes++
        deps.background(() => refreshRemoteName(user, participation, parsed, deps))
      }
      return participation
    }),
  )
}
