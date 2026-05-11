import { isExerciseActivityType } from '@aurboda/api-spec'

import type { Activity } from '../../state/api/types'

const durationMinutes = (a: Activity): number =>
  a.end_time ? (a.end_time.getTime() - a.start_time.getTime()) / 60000 : 0

const durationHours = (a: Activity): number => durationMinutes(a) / 60

/**
 * Summarize activities by category for the ActivitySummaryWidget cards.
 * Exercise counts include every Health Connect exercise subtype (running,
 * cycling, …) plus the generic `'exercise'` bucket — see #748.
 */
export const summarizeActivities = (activities: readonly Activity[]) => {
  const exerciseSessions = activities.filter((a) => isExerciseActivityType(a.activity_type))
  const sleepSessions = activities.filter((a) => a.activity_type === 'sleep')
  const meditationSessions = activities.filter((a) => a.activity_type === 'meditation')

  return {
    avgSleepHours:
      sleepSessions.length > 0
        ? sleepSessions.reduce((sum, a) => sum + durationHours(a), 0) / sleepSessions.length
        : null,
    exerciseCount: exerciseSessions.length,
    meditationCount: meditationSessions.length,
    sleepCount: sleepSessions.length,
    totalExerciseMinutes: exerciseSessions.reduce((sum, a) => sum + durationMinutes(a), 0),
    totalMeditationMinutes: meditationSessions.reduce((sum, a) => sum + durationMinutes(a), 0),
  }
}
