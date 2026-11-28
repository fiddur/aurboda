import type { WeatherSyncResult } from '@aurboda/api-spec'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export const weatherSyncMessage = (result: WeatherSyncResult): string => {
  if (result.status !== 'success') return result.error ?? 'Sync failed'
  const stored = `${plural(result.hours_stored, 'hour')} of weather stored`
  return result.cells_deferred > 0
    ? `${stored}; ${plural(result.cells_deferred, 'more place')} will follow in the next sync`
    : stored
}
