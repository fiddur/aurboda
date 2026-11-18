import type { TrainingLoadDeps } from './deps.ts'

import { recomputeImpulseBuckets } from './recompute.ts'

/** The user's recompute in flight, or a new one from `fromHour`; `fromHour` is unused when joining. */
export const startOrJoinRecompute = (deps: TrainingLoadDeps, user: string, fromHour: Date): Promise<void> => {
  const running = deps.recomputing.get(user)
  if (running) return running

  const run = recomputeImpulseBuckets(deps, user, fromHour)
    .then(() => {})
    .finally(() => {
      deps.recomputing.delete(user)
    })
  run.catch((error: unknown) => deps.onRecomputeError(user, error))
  deps.recomputing.set(user, run)
  return run
}

/** True when `run` finished within `ms`, false when it is still running; rejects when it failed in time. */
export const finishedWithin = async (run: Promise<void>, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([run.then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}
