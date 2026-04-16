import { useQuery } from '@tanstack/react-query'

import { GoalProgressBar } from '../../components/GoalProgressBar'
import { GoalsSettings } from '../../components/GoalsSettings'
import { fetchGoalsProgress, fetchUserSettings } from '../../state/api'
import { auth } from '../../state/auth'
import { metricLabels } from '../../utils/metricLabels'
import './style.css'

// eslint-disable-next-line complexity -- handles both metric and trend goal types
export function Goals() {
  const isLoggedIn = auth.value.token

  const { data: userSettings, isLoading: settingsLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const { data: goalsProgress, isLoading: progressLoading } = useQuery({
    enabled: !!isLoggedIn && !!userSettings?.goals?.length,
    queryFn: fetchGoalsProgress,
    queryKey: ['goalsProgress'],
    refetchInterval: 60000, // Refresh every minute
  })

  if (!isLoggedIn) {
    return (
      <div class="goals-page">
        <h1>Goals</h1>
        <p>Please log in to view your goals.</p>
      </div>
    )
  }

  if (settingsLoading || progressLoading) {
    return (
      <div class="goals-page">
        <h1>Goals</h1>
        <p class="loading">Loading...</p>
      </div>
    )
  }

  const goals = userSettings?.goals ?? []

  if (goals.length === 0) {
    return (
      <div class="goals-page">
        <h1>Goals</h1>
        <GoalsSettings goals={goals} />
      </div>
    )
  }

  // Match progress data with goals
  const progressMap = new Map(goalsProgress?.map((p) => [p.id, p]) ?? [])

  // Check if all metric goals have the same window
  const metricGoals = goals.filter((g) => g.goal_type !== 'trend')
  const allSameWindow =
    metricGoals.length > 0 &&
    metricGoals.every(
      (g) => g.goal_type === 'metric' && g.window === (metricGoals[0] as { window: string }).window,
    )

  return (
    <div class="goals-page">
      <h1>Goals</h1>

      <div class="goals-list">
        {goals.map((goal) => {
          const progress = progressMap.get(goal.id)
          if (!progress) {
            // Fallback if progress not yet loaded
            return (
              <div key={goal.id} class="goal-progress loading">
                <div class="goal-header">
                  <span class="goal-label">
                    {goal.goal_type === 'trend' ? goal.pattern : (metricLabels[goal.metric] ?? goal.metric)}
                  </span>
                </div>
                <div class="progress-container">
                  <div class="progress-bar loading" style={{ width: '0%' }} />
                </div>
              </div>
            )
          }
          return <GoalProgressBar key={goal.id} goal={progress} showWindow={!allSameWindow} />
        })}
      </div>

      <p class="goals-footer">
        {allSameWindow && metricGoals.length > 0 ? (
          <>Rolling {(metricGoals[0] as { window: string }).window} window from today.</>
        ) : metricGoals.length > 0 ? (
          <>Rolling windows from today.</>
        ) : null}
      </p>

      <GoalsSettings goals={goals} />
    </div>
  )
}
