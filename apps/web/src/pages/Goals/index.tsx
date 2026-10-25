import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'

import { type GoalHistoryRange, goalsUrl, parseRange } from '../../components/goal-history-range'
import { GoalHistoryPanel } from '../../components/GoalHistoryPanel'
import { GoalProgressBar } from '../../components/GoalProgressBar'
import { GoalsSettings } from '../../components/GoalsSettings'
import { fetchGoalsProgress, fetchUserSettings } from '../../state/api'
import { auth } from '../../state/auth'
import { metricLabels } from '../../utils/metricLabels'
import './style.css'

// eslint-disable-next-line complexity -- handles both metric and trend goal types
export function Goals() {
  const isLoggedIn = auth.value.token
  const { query, route } = useLocation()
  const openGoalId = query.history
  const range = parseRange(query.range)
  const embed = query.embed === '1'

  const toggleGoal = (id: string) =>
    route(goalsUrl({ embed, history: id === openGoalId ? undefined : id, range }))
  const changeRange = (r: GoalHistoryRange) => route(goalsUrl({ embed, history: openGoalId, range: r }), true)

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

  const progressMap = new Map(goalsProgress?.map((p) => [p.id, p]) ?? [])

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
          const isOpen = goal.id === openGoalId
          return (
            <div key={goal.id}>
              <div
                class="goal-card"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggleGoal(goal.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  toggleGoal(goal.id)
                }}
              >
                <GoalProgressBar goal={progress} showWindow={!allSameWindow} />
              </div>
              {isOpen && <GoalHistoryPanel goal={goal} range={range} onRangeChange={changeRange} />}
            </div>
          )
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
