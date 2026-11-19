/**
 * Pure changes to the stored training load settings, each applied atomically through
 * `TrainingLoadDeps.mutateTrainingLoadSettings` (or `mutateTrainingLoadSettings` in the db layer).
 */
import type { TrainingLoadSettings } from '@aurboda/api-spec'

import { floorToHour } from './banister.ts'

/** How long a recompute's claim lasts without being renewed; it is renewed after every chunk. */
export const LEASE_MS = 2 * 60 * 1000

const earlier = (stored: string | undefined, candidate: Date): string =>
  stored && new Date(stored) <= candidate ? stored : candidate.toISOString()

/** Hours from `from` on need recomputing: the watermark moves back to it and the dirty rev counts the mark. */
export const withDirtyMark = (
  current: TrainingLoadSettings | undefined,
  from: Date,
): TrainingLoadSettings => ({
  ...current,
  impulse_dirty_rev: (current?.impulse_dirty_rev ?? 0) + 1,
  impulse_watermark: earlier(current?.impulse_watermark, from),
})

/** The stored buckets cover the hours from `from` on as well. */
export const withComputedFrom = (
  current: TrainingLoadSettings | undefined,
  from: Date,
): TrainingLoadSettings => ({
  ...current,
  impulse_computed_from: earlier(current?.impulse_computed_from, from),
})

/** Free, expired, or already this holder's. */
export const leaseAvailable = (
  current: TrainingLoadSettings | undefined,
  holder: string,
  now: number,
): boolean => {
  const lease = current?.impulse_recompute_lease
  return !lease || lease.holder === holder || new Date(lease.until).getTime() <= now
}

export const withLease = (
  current: TrainingLoadSettings | undefined,
  holder: string,
  now: number,
): TrainingLoadSettings => ({
  ...current,
  impulse_recompute_lease: { holder, until: new Date(now + LEASE_MS).toISOString() },
})

export const withoutLease = (
  current: TrainingLoadSettings | undefined,
  holder: string,
): TrainingLoadSettings | undefined => {
  if (current?.impulse_recompute_lease?.holder !== holder) return current
  const { impulse_recompute_lease: _released, ...rest } = current
  return rest
}

/**
 * After a recompute wrote [.., chunkEnd): where the run continues and the settings to store. With no
 * dirty mark since `revBefore` was read, everything before `chunkEnd` is done. A mark made meanwhile
 * may lie inside the chunk just written (its data read before the change), so a watermark before
 * `chunkEnd` is kept and the run goes back to it.
 */
export const settleChunk = (
  current: TrainingLoadSettings | undefined,
  revBefore: number,
  chunkEnd: Date,
  currentHour: Date,
): { next: Date; settings: TrainingLoadSettings } => {
  const atEnd = chunkEnd >= currentHour
  const moved = { ...current, impulse_watermark: atEnd ? undefined : chunkEnd.toISOString() }
  if ((current?.impulse_dirty_rev ?? 0) === revBefore) return { next: chunkEnd, settings: moved }
  const stored = current?.impulse_watermark
  if (stored && new Date(stored) < chunkEnd) {
    return { next: floorToHour(new Date(stored)), settings: { ...current } }
  }
  return { next: chunkEnd, settings: atEnd ? { ...current } : moved }
}
