/**
 * Cache the maximum observed HR from time_series in user settings.
 *
 * Without caching, every read of training load triggers an expensive 1-year
 * scan over the heart_rate time series. With caching, only the first
 * miss-or-stale read pays that cost; subsequent reads use the cached value.
 *
 * Shared between read (`query.ts`) and write (`recompute.ts`) paths.
 */
import type { TrainingLoadSettings } from '@aurboda/api-spec'

import type { TrainingLoadDeps } from './deps.ts'

/**
 * Resolve max observed HR using cached value from settings if available,
 * falling back to the expensive 1-year `getTimeSeriesStats` scan.
 * Caches the result in settings for future requests.
 *
 * @param fireAndForget - If true, cache write doesn't block. Used on the read path.
 */
export const getOrCacheMaxObservedHr = async (
  deps: TrainingLoadDeps,
  user: string,
  trainingLoadSettings: TrainingLoadSettings | undefined,
  fireAndForget = true,
): Promise<number | undefined> => {
  const cached = trainingLoadSettings?.observed_hr_max
  if (cached && cached > 100) return cached

  const observed = await deps.getMaxObservedHr(user)
  if (observed && observed > 100 && observed !== cached) {
    const writePromise = deps.updateTrainingLoadSettings(user, {
      observed_hr_max: observed,
    })
    if (fireAndForget) writePromise.catch(() => {})
    else await writePromise
  }
  return observed
}
