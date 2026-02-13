/**
 * ActivitySummaryWidget - Displays workout/sleep/meditation stats.
 */

import type { ActivitySummaryConfig } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { fetchActivities, type Activity } from '../../state/api'

interface ActivitySummaryWidgetProps {
  config: ActivitySummaryConfig
}

// eslint-disable-next-line max-lines-per-function -- TODO: refactor
export function ActivitySummaryWidget({ config }: ActivitySummaryWidgetProps) {
  const { lookbackDays = 7, showWorkouts = true, showSleep = true, showMeditation = true } = config

  const end = endOfDay(new Date())
  const start = startOfDay(subDays(new Date(), lookbackDays))

  const activitiesQuery = useQuery({
    queryFn: () => fetchActivities(start, end),
    queryKey: ['activities', formatISO(start, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const activities = activitiesQuery.data ?? []

  const exerciseSessions = activities.filter((a: Activity) => a.activityType === 'exercise')
  const sleepSessions = activities.filter((a: Activity) => a.activityType === 'sleep')
  const meditationSessions = activities.filter((a: Activity) => a.activityType === 'meditation')

  const totalExerciseMinutes = exerciseSessions.reduce((sum: number, a: Activity) => {
    if (!a.endTime) return sum
    return sum + (a.endTime.getTime() - a.startTime.getTime()) / 60000
  }, 0)

  const avgSleepHours =
    sleepSessions.length > 0 ?
      sleepSessions.reduce((sum: number, a: Activity) => {
        if (!a.endTime) return sum
        return sum + (a.endTime.getTime() - a.startTime.getTime()) / 3600000
      }, 0) / sleepSessions.length
    : null

  const totalMeditationMinutes = meditationSessions.reduce((sum: number, a: Activity) => {
    if (!a.endTime) return sum
    return sum + (a.endTime.getTime() - a.startTime.getTime()) / 60000
  }, 0)

  if (activitiesQuery.isLoading) {
    return (
      <div class="activity-summary">
        <h3>Last {lookbackDays} Days</h3>
        <div class="activity-grid">
          <div class="activity-item">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div class="activity-summary">
      <h3>Last {lookbackDays} Days</h3>
      <div class="activity-grid">
        {showWorkouts && (
          <div class="activity-item">
            <span class="activity-icon exercise-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6.5 6.5h11v11h-11z" />
                <path d="M6.5 17.5v3M17.5 17.5v3M6.5 3.5v3M17.5 3.5v3" />
              </svg>
            </span>
            <div class="activity-details">
              <span class="activity-value">{exerciseSessions.length}</span>
              <span class="activity-label">Workouts</span>
            </div>
            <div class="activity-sub">{Math.round(totalExerciseMinutes)} min total</div>
          </div>
        )}

        {showSleep && (
          <div class="activity-item">
            <span class="activity-icon sleep-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            </span>
            <div class="activity-details">
              <span class="activity-value">{avgSleepHours !== null ? avgSleepHours.toFixed(1) : '--'}</span>
              <span class="activity-label">Avg Sleep (hrs)</span>
            </div>
            <div class="activity-sub">{sleepSessions.length} nights tracked</div>
          </div>
        )}

        {showMeditation && (
          <div class="activity-item">
            <span class="activity-icon meditation-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </span>
            <div class="activity-details">
              <span class="activity-value">{meditationSessions.length}</span>
              <span class="activity-label">Meditations</span>
            </div>
            <div class="activity-sub">{Math.round(totalMeditationMinutes)} min total</div>
          </div>
        )}
      </div>
    </div>
  )
}
