/**
 * GoalProgressWidget - Displays goal progress bars on the dashboard.
 *
 * Split into a presentational `GoalProgressView` and a fetching container.
 */

import type { GoalProgressConfig, GoalProgressData } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchGoalsProgress } from '../../state/api'
import { GoalProgressBar } from '../GoalProgressBar'

interface GoalProgressViewProps {
  config: GoalProgressConfig
  data: GoalProgressData | null
}

export function GoalProgressView({ config, data }: GoalProgressViewProps) {
  const goals = data?.goals ?? []

  if (goals.length === 0) {
    return (
      <div class="goal-progress-widget">
        <h4>Goals</h4>
        <div class="goal-progress-widget-empty">
          No goals configured.{' '}
          <a href="/goals" class="goal-progress-widget-link">
            Set up goals
          </a>
        </div>
      </div>
    )
  }

  return (
    <div class="goal-progress-widget">
      <h4>Goals</h4>
      <div class="goal-progress-widget-list">
        {goals.map((goal) => (
          <GoalProgressBar key={goal.id} goal={goal} compact={config.compact} />
        ))}
      </div>
    </div>
  )
}

interface GoalProgressWidgetProps {
  config: GoalProgressConfig
}

export function GoalProgressWidget({ config }: GoalProgressWidgetProps) {
  const goalsQuery = useQuery({
    queryFn: fetchGoalsProgress,
    queryKey: ['goalsProgress'],
    staleTime: 5 * 60 * 1000,
  })

  if (goalsQuery.isLoading) {
    return (
      <div class="goal-progress-widget">
        <h4>Goals</h4>
        <div class="goal-progress-widget-loading">Loading goals...</div>
      </div>
    )
  }

  if (goalsQuery.isError || !goalsQuery.data) {
    return (
      <div class="goal-progress-widget">
        <h4>Goals</h4>
        <div class="goal-progress-widget-empty">Unable to load goals</div>
      </div>
    )
  }

  return <GoalProgressView config={config} data={{ goals: goalsQuery.data }} />
}
