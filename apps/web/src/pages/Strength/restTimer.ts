export const DEFAULT_REST_S = 120
export const REST_EXTEND_S = 30
export const REST_LENGTHS_S = [60, 90, 120, 150, 180, 240, 300]

export interface RestAdjust {
  for_set_at: string
  extra_s: number
  skipped: boolean
}

export interface RestState {
  remaining_s: number
  total_s: number
}

/** The rest after the newest set, counted from its time so a reload keeps it; undefined when not resting. */
export const restState = (
  lastSetAt: string | undefined,
  lengthS: number,
  now: number,
  adjust?: RestAdjust,
): RestState | undefined => {
  if (!lastSetAt) return undefined
  const started = Date.parse(lastSetAt)
  if (Number.isNaN(started)) return undefined
  const own = adjust?.for_set_at === lastSetAt ? adjust : undefined
  if (own?.skipped) return undefined
  const total = lengthS + (own?.extra_s ?? 0)
  const remaining = Math.ceil(total - Math.max(0, now - started) / 1000)
  return remaining > 0 ? { remaining_s: remaining, total_s: total } : undefined
}

export const extendRest = (lastSetAt: string, adjust: RestAdjust | undefined): RestAdjust => ({
  extra_s: (adjust?.for_set_at === lastSetAt ? adjust.extra_s : 0) + REST_EXTEND_S,
  for_set_at: lastSetAt,
  skipped: false,
})

export const skipRest = (lastSetAt: string): RestAdjust => ({
  extra_s: 0,
  for_set_at: lastSetAt,
  skipped: true,
})

export const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export const elapsedSeconds = (startTime: string, now: number): number =>
  Math.max(0, Math.floor((now - Date.parse(startTime)) / 1000))
