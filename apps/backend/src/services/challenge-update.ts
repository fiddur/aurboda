import type { ChallengePatch, ChallengeRecord } from '../db/index.ts'

import { getChallengeById, hasRemoteChallengeMember, updateChallenge } from '../db/index.ts'
import { sameSpec } from './challenge-spec.ts'

export const SPEC_LOCKED_MESSAGE =
  "The scoring can't change once someone from another instance has joined; name, dates and visibility can."

export type UpdateHostedChallengeResult =
  | { status: 'updated'; record: ChallengeRecord }
  | { status: 'not_found' }
  | { status: 'spec_locked' }

/**
 * Update a hosted challenge, refusing a spec change once a remote member has joined: their
 * participation scores the spec it joined with, so a new one would rank them on something else.
 * An unchanged spec in the patch passes, so a client may send the whole challenge back.
 */
export const updateHostedChallenge = async (
  user: string,
  id: string,
  patch: ChallengePatch,
): Promise<UpdateHostedChallengeResult> => {
  if (patch.spec !== undefined) {
    const existing = await getChallengeById(user, id)
    if (!existing) return { status: 'not_found' }
    if (!sameSpec(existing.spec, patch.spec) && (await hasRemoteChallengeMember(user, id))) {
      return { status: 'spec_locked' }
    }
  }
  const record = await updateChallenge(user, id, patch)
  return record ? { record, status: 'updated' } : { status: 'not_found' }
}
