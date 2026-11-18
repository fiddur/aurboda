import type { TrainingLoadDeps } from './deps.ts'

import { floorToHour } from './banister.ts'
import { fillImpulseBuckets, prepareRun, recomputeImpulseBuckets } from './recompute.ts'
import { leaseAvailable, withComputedFrom, withLease, withoutLease } from './state.ts'

const claimLease = async (deps: TrainingLoadDeps, user: string): Promise<boolean> => {
  let claimed = false
  await deps.mutateTrainingLoadSettings(user, (current) => {
    const now = Date.now()
    claimed = leaseAvailable(current, deps.leaseHolder, now)
    return claimed ? withLease(current, deps.leaseHolder, now) : current
  })
  return claimed
}

const lowerComputedFrom = (deps: TrainingLoadDeps, user: string, from: Date) =>
  deps.mutateTrainingLoadSettings(user, (current) => withComputedFrom(current, from))

/** `impulse_computed_from`, set from the earliest stored bucket when only the buckets know it. */
const resolveComputedFrom = async (
  deps: TrainingLoadDeps,
  user: string,
  stored: string | undefined,
): Promise<Date | undefined> => {
  if (stored) return new Date(stored)
  const earliest = await deps.getEarliestImpulseBucket(user)
  if (!earliest) return undefined
  await lowerComputedFrom(deps, user, floorToHour(earliest))
  return floorToHour(earliest)
}

/**
 * Brings the stored buckets up to date and back to `from`: recomputes from the watermark, then
 * fills the hours between `from` and the earliest stored one. Without any stored bucket or
 * `impulse_computed_from`, it bootstraps from `from` (or an earlier watermark) instead.
 * False when it stopped because another process took the lease over.
 */
const runImpulseJob = async (deps: TrainingLoadDeps, user: string, from: Date): Promise<boolean> => {
  const context = await prepareRun(deps, user)
  const options = { context, lease: deps.leaseHolder }
  const stored = context.trainingLoad
  const watermark = stored?.impulse_watermark ? floorToHour(new Date(stored.impulse_watermark)) : undefined
  let computedFrom = await resolveComputedFrom(deps, user, stored?.impulse_computed_from)

  if (!computedFrom || watermark) {
    const bootstrapFrom = watermark && watermark < from ? watermark : from
    const start = computedFrom && watermark ? watermark : bootstrapFrom
    const run = await recomputeImpulseBuckets(deps, user, start, options)
    if (run.lease_lost) return false
    const covered = run.covered_from ?? start
    if (!computedFrom || covered < computedFrom) {
      computedFrom = covered
      await lowerComputedFrom(deps, user, covered)
    }
  }

  if (from >= computedFrom) return true
  return !(await fillImpulseBuckets(deps, user, from, computedFrom, options)).lease_lost
}

const runWithLease = async (deps: TrainingLoadDeps, user: string, from: Date): Promise<boolean> => {
  if (!(await claimLease(deps, user))) return false
  try {
    return await runImpulseJob(deps, user, from)
  } finally {
    await deps.mutateTrainingLoadSettings(user, (current) => withoutLease(current, deps.leaseHolder))
  }
}

/**
 * The user's recompute in flight in this process, or a new one back to `from`; `from` is unused
 * when joining. Resolves false when another process holds the user's recompute lease.
 */
export const startOrJoinRecompute = (deps: TrainingLoadDeps, user: string, from: Date): Promise<boolean> => {
  const running = deps.recomputing.get(user)
  if (running) return running

  const run = runWithLease(deps, user, from).finally(() => {
    deps.recomputing.delete(user)
  })
  run.catch((error: unknown) => deps.onRecomputeError(user, error))
  deps.recomputing.set(user, run)
  return run
}

/** True when `run` completed here within `ms`; false while it runs, or when it ran elsewhere. Rejects when it failed in time. */
export const finishedWithin = async (run: Promise<boolean>, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([run, timeout])
  } finally {
    clearTimeout(timer)
  }
}
