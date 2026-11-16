import type { ChallengePatch, ChallengeRecord } from '../db/index.ts'

import { getChallengeById, updateChallenge } from '../db/index.ts'
import { pushChallengeToLocalMembers } from './challenge-participation-sync.ts'
import { sameSpec } from './challenge-spec.ts'

export const LOCKED_MESSAGES = {
  spec_locked:
    "The scoring can't change once someone from another instance has joined; the name and visibility can.",
  window_locked:
    "The dates and timezone can't change once someone from another instance has joined; the name and visibility can.",
} as const

export type UpdateHostedChallengeResult =
  | { status: 'updated'; record: ChallengeRecord }
  | { status: 'not_found' }
  | { status: keyof typeof LOCKED_MESSAGES }

const moved = (next: Date | undefined, current: Date): boolean =>
  next !== undefined && next.getTime() !== current.getTime()

/** Which frozen part of the challenge the patch changes; values sent back unchanged change nothing. */
export const frozenChange = (existing: ChallengeRecord, patch: ChallengePatch): 'spec' | 'window' | null => {
  if (patch.spec !== undefined && !sameSpec(existing.spec, patch.spec)) return 'spec'
  if (
    moved(patch.start_ts, existing.start_ts) ||
    moved(patch.end_ts, existing.end_ts) ||
    (patch.timezone !== undefined && patch.timezone !== existing.timezone)
  ) {
    return 'window'
  }
  return null
}

/**
 * Update a hosted challenge, refusing a change to its spec, dates or timezone once a remote member
 * has joined: their participation scores the spec and window it joined with, so a new one would
 * rank them on something else. The refusal is part of the UPDATE itself, so a member joining
 * between the read and the write cannot slip past it.
 */
export const updateHostedChallenge = async (
  user: string,
  id: string,
  patch: ChallengePatch,
  { webHost }: { webHost?: string } = {},
): Promise<UpdateHostedChallengeResult> => {
  const existing = await getChallengeById(user, id)
  if (!existing) return { status: 'not_found' }
  const frozen = frozenChange(existing, patch)
  const record = await updateChallenge(user, id, patch, { unlessRemoteMember: frozen !== null })
  if (record) {
    if (webHost) await pushChallengeToLocalMembers(user, record, webHost)
    return { record, status: 'updated' }
  }
  if (frozen === null || !(await getChallengeById(user, id))) return { status: 'not_found' }
  return { status: frozen === 'spec' ? 'spec_locked' : 'window_locked' }
}
