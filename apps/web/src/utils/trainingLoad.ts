import type { RecoveryZones, TrainingLoadPoint, TrainingLoadSettings, WorkoutTrimp } from '@aurboda/api-spec'

export type RecoveryZone = 'undertrained' | 'balanced' | 'strained' | 'very_strained'

export const RECOVERY_ZONES: RecoveryZone[] = ['undertrained', 'balanced', 'strained', 'very_strained']

export const RECOVERY_ZONE_LABELS: Record<RecoveryZone, string> = {
  balanced: 'Balanced',
  strained: 'Strained',
  undertrained: 'Undertrained',
  very_strained: 'Very Strained',
}

export const recoveryZone = (atl: number, zones: RecoveryZones): RecoveryZone => {
  if (atl < zones.balanced_min) return 'undertrained'
  if (atl <= zones.balanced_max) return 'balanced'
  if (atl <= zones.strained_max) return 'strained'
  return 'very_strained'
}

export type FormState = 'fresh' | 'fatigued'

export const formState = (tsb: number): FormState => (tsb >= 0 ? 'fresh' : 'fatigued')

export interface ZoneSegment {
  zone: RecoveryZone
  /** Time of the segment's first point. */
  start: string
  /** Time of the segment's last point. */
  end: string
  count: number
}

export const zoneSegments = (points: TrainingLoadPoint[], zones: RecoveryZones): ZoneSegment[] =>
  points.reduce<ZoneSegment[]>((segments, point) => {
    const zone = recoveryZone(point.atl, zones)
    const last = segments.at(-1)
    if (last?.zone === zone) {
      last.end = point.time
      last.count++
    } else {
      segments.push({ count: 1, end: point.time, start: point.time, zone })
    }
    return segments
  }, [])

export const newestFirst = (workouts: WorkoutTrimp[]): WorkoutTrimp[] =>
  workouts.toSorted((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))

export type TimeConstantKey = 'tau_acute' | 'tau_chronic'

/** Days from a time-constant field: null when empty (use the default), 'invalid' unless positive. */
export const parseTimeConstant = (value: string): number | null | 'invalid' => {
  if (value.trim() === '') return null
  const days = Number(value)
  return Number.isFinite(days) && days > 0 ? days : 'invalid'
}

/**
 * The whole `training_load` settings object with one time constant changed (null drops it, so the
 * default applies). An update replaces the stored object, so the other fields are carried over.
 */
export const withTimeConstant = (
  current: TrainingLoadSettings | null | undefined,
  key: TimeConstantKey,
  days: number | null,
): TrainingLoadSettings => {
  const { [key]: _previous, ...rest } = current ?? {}
  return days === null ? rest : { ...rest, [key]: days }
}
