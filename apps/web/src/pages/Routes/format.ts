import type { RouteEffort } from '@aurboda/api-spec'

/** Elapsed seconds as `"H:MM:SS"`, or `"M:SS"` under an hour. */
export const formatElapsed = (seconds: number): string => {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * One chart point per run that has the value, oldest first (efforts come newest
 * first). Pace is charted in minutes per km.
 */
export const effortSeries = (
  efforts: RouteEffort[],
  field: 'avg_hr' | 'pace_s_per_km',
): { date: string; value: number }[] =>
  efforts
    .flatMap((e) => {
      const value = e[field]
      if (value === undefined) return []
      return [
        {
          date: e.start_time,
          value: field === 'pace_s_per_km' ? Math.round((value / 60) * 100) / 100 : value,
        },
      ]
    })
    .reverse()
