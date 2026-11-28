import type { WeatherSyncResult } from '@aurboda/api-spec'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export const weatherSyncMessage = (result: WeatherSyncResult): string => {
  if (result.status !== 'success') return result.error ?? 'Sync failed'
  const stored = `${plural(result.hours_stored, 'hour')} of weather stored`
  const message =
    result.cells_deferred > 0
      ? `${stored}; ${plural(result.cells_deferred, 'more place')} left, sync again to fetch ${result.cells_deferred === 1 ? 'it' : 'them'}`
      : stored
  return result.window_end
    ? `${message}. Fetched up to ${result.window_end.slice(0, 10)}, fetch again from there to continue`
    : message
}
