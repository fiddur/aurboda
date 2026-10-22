import type { SleepData } from '@fiddur/garmin-connect/dist/garmin/types/sleep'

// Garmin's "...GMT" timestamp strings sometimes carry an explicit zone suffix
// (e.g. "+02:00", seen on naps) and sometimes none. Parse as-is when a Z/offset
// suffix is present, and fall back to treating bare strings as UTC.
export const parseGarminGmt = (ts: string | null | undefined): Date | null => {
  if (!ts) return null
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(ts)
  const d = new Date(hasZone ? ts : `${ts}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface SleepStage {
  startTime: string
  endTime: string
  stage: number
}

/** Garmin `activityLevel` → Health Connect sleep stage (0 deep, 1 light, 2 REM, 3 awake). */
const GARMIN_LEVEL_TO_HC_STAGE: Record<number, number> = { 0: 5, 1: 4, 2: 6, 3: 1 }

/**
 * Garmin's `sleepLevels` timeline in the Health Connect `stages` shape the web
 * hypnogram reads, so both sources fill `data.stages` alike.
 */
export const garminSleepLevelsToStages = (levels: SleepData['sleepLevels'] | undefined): SleepStage[] =>
  (levels ?? [])
    .flatMap((level) => {
      const stage = GARMIN_LEVEL_TO_HC_STAGE[level?.activityLevel]
      const start = parseGarminGmt(level?.startGMT)
      const end = parseGarminGmt(level?.endGMT)
      if (stage === undefined || !start || !end) return []
      return [{ end, stage, start }]
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ end, stage, start }) => ({ endTime: end.toISOString(), stage, startTime: start.toISOString() }))
