/**
 * ActivitySummaryWidget - Displays workout/sleep/meditation stats.
 *
 * Split into a presentational `ActivitySummaryView` and a fetching container.
 */

import type { ActivitySummaryConfig, ActivitySummaryData } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'

import { fetchActivities } from '../../state/api'
import { summarizeActivities } from './activitySummary'

interface ActivitySummaryViewProps {
  config: ActivitySummaryConfig
  data: ActivitySummaryData | null
  loading?: boolean
}

export function ActivitySummaryView({ config, data, loading = false }: ActivitySummaryViewProps) {
  const { lookback_days = 7, show_workouts = true, show_sleep = true, show_meditation = true } = config

  if (loading) {
    return (
      <div class="activity-summary">
        <h3>Last {lookback_days} Days</h3>
        <div class="activity-grid">
          <div class="activity-item">Loading...</div>
        </div>
      </div>
    )
  }

  const {
    avgSleepHours,
    exerciseCount,
    meditationCount,
    sleepCount,
    totalExerciseMinutes,
    totalMeditationMinutes,
  } = summarizeActivities(
    (data?.activities ?? []).map((a) => ({
      activity_type: a.activity_type,
      end_time: a.end_time ? new Date(a.end_time) : undefined,
      start_time: new Date(a.start_time),
    })),
  )

  return (
    <div class="activity-summary">
      <h3>Last {lookback_days} Days</h3>
      <div class="activity-grid">
        {show_workouts && (
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
              <span class="activity-value">{exerciseCount}</span>
              <span class="activity-label">Workouts</span>
            </div>
            <div class="activity-sub">{Math.round(totalExerciseMinutes)} min total</div>
          </div>
        )}

        {show_sleep && (
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
            <div class="activity-sub">{sleepCount} nights tracked</div>
          </div>
        )}

        {show_meditation && (
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
              <span class="activity-value">{meditationCount}</span>
              <span class="activity-label">Meditations</span>
            </div>
            <div class="activity-sub">{Math.round(totalMeditationMinutes)} min total</div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ActivitySummaryWidgetProps {
  config: ActivitySummaryConfig
}

export function ActivitySummaryWidget({ config }: ActivitySummaryWidgetProps) {
  const { lookback_days = 7 } = config

  const end = endOfDay(new Date())
  const start = startOfDay(subDays(new Date(), lookback_days))

  const activitiesQuery = useQuery({
    queryFn: () => fetchActivities(start, end),
    queryKey: ['activities', formatISO(start, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const data: ActivitySummaryData = {
    activities: (activitiesQuery.data ?? []).map((a) => ({
      activity_type: a.activity_type,
      end_time: a.end_time?.toISOString(),
      start_time: a.start_time.toISOString(),
    })),
  }

  return <ActivitySummaryView config={config} data={data} loading={activitiesQuery.isLoading} />
}
