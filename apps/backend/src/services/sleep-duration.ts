/**
 * Health Connect sleep stage values that count as actual sleep.
 * 1=Awake, 2=Sleeping, 3=Out of bed, 4=Light, 5=Deep, 6=REM
 */
const SLEEP_STAGES = new Set([2, 4, 5, 6])

interface SleepStage {
  startTime?: string
  endTime?: string
  stage?: number
}

/**
 * Supports two formats:
 * - Health Connect: `data.stages` array with `{startTime, endTime, stage}` entries
 * - Oura: `data.total_sleep_duration` in seconds
 *
 * Health Connect stages take priority when both are present.
 */
export const computeSleepMinutes = (data: Record<string, unknown> | undefined): number | undefined => {
  if (!data) return undefined

  const stages = data.stages
  if (Array.isArray(stages)) {
    let ms = 0
    for (const stage of stages as SleepStage[]) {
      if (
        SLEEP_STAGES.has(stage.stage ?? -1) &&
        typeof stage.startTime === 'string' &&
        typeof stage.endTime === 'string'
      ) {
        ms += new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime()
      }
    }
    return ms > 0 ? Math.round(ms / 60000) : undefined
  }

  // Oura total_sleep_duration format (in seconds)
  const totalSleepDuration = data.total_sleep_duration
  if (typeof totalSleepDuration === 'number' && totalSleepDuration > 0) {
    return Math.round(totalSleepDuration / 60)
  }

  return undefined
}
