/**
 * GoalProgressWidget - Displays goal progress bars on the dashboard.
 */

import type { GoalProgressConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchGoalsProgress } from '../../state/api'
import { GoalProgressBar } from '../GoalProgressBar'

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

  if (goalsQuery.data.length === 0) {
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
        {goalsQuery.data.map((goal) => (
          <GoalProgressBar key={goal.id} goal={goal} compact={config.compact} />
        ))}
      </div>
    </div>
  )
}
