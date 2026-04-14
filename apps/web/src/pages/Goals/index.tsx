import { metricUnits } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import { GoalsSettings } from '../../components/GoalsSettings'
import { fetchGoalsProgress, fetchUserSettings, type GoalProgress } from '../../state/api'
import { auth } from '../../state/auth'
import { metricLabels } from '../../utils/metricLabels'
import './style.css'

// Format value for display (e.g., seconds to hours:minutes)
const formatValue = (metric: string, value: number): string => {
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') {
    const hours = Math.floor(value / 3600)
    const minutes = Math.floor((value % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }
  if (unit === 'm') {
    // Distance in meters to km
    return `${(value / 1000).toFixed(1)} km`
  }
  if (unit === 'count') {
    return value.toLocaleString()
  }
  return `${value.toLocaleString()} ${unit}`
}

// Format "losing tomorrow" value
const formatLosingTomorrow = (metric: string, value: number): string => {
  if (value === 0) return ''
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') {
    const hours = Math.floor(value / 3600)
    const minutes = Math.floor((value % 3600) / 60)
    if (hours > 0) {
      return `-${hours}h ${minutes}m`
    }
    return `-${minutes}m`
  }
  if (unit === 'count') {
    return `-${value.toLocaleString()}`
  }
  return `-${value.toLocaleString()} ${unit}`
}

interface GoalProgressBarProps {
  goal: GoalProgress
  showWindow?: boolean
}

// eslint-disable-next-line complexity -- handles both metric and trend goal types
function GoalProgressBar({ goal, showWindow }: GoalProgressBarProps) {
  const { current, max, min } = goal

  // Label and value formatting depends on goal type
  const label = goal.goal_type === 'trend' ? goal.pattern : (metricLabels[goal.metric] ?? goal.metric)
  const windowLabel = goal.goal_type === 'trend' ? goal.display_period : goal.window
  const valueText =
    goal.goal_type === 'trend'
      ? `${current.toFixed(2)} ${goal.display_unit}`
      : formatValue(goal.metric, current)
  const losingText =
    goal.goal_type === 'metric' ? formatLosingTomorrow(goal.metric, goal.losing_tomorrow) : ''

  // Calculate progress percentages
  const target = max ?? min ?? 1
  const progressPercent = (current / target) * 100
  const minPercent = min && max ? (min / max) * 100 : 100
  const overflow = progressPercent > 100 ? progressPercent - 100 : 0
  const cappedProgress = Math.min(progressPercent, 100)

  // Determine bar color based on progress
  const getBarColor = () => {
    if (min && max) {
      if (current >= max) return 'over-max'
      if (current >= min) return 'in-range'
      return 'below-min'
    }
    if (min) return current >= min ? 'met' : 'below-min'
    if (max) return current > max ? 'over-max' : 'in-range'
    return 'neutral'
  }

  const barColor = getBarColor()

  const formatTarget = (value: number) =>
    goal.goal_type === 'trend' ? `${value.toFixed(2)} ${goal.display_unit}` : formatValue(goal.metric, value)

  return (
    <div class="goal-progress">
      <div class="goal-header">
        <span class="goal-label">
          {label}
          {showWindow && <span class="goal-window"> ({windowLabel})</span>}
        </span>
        {losingText && <span class="losing-tomorrow">({losingText} tomorrow)</span>}
        <span class="goal-value">{valueText}</span>
      </div>

      <div class="progress-container">
        <div class={`progress-bar ${barColor}`} style={{ width: `${cappedProgress}%` }} />
        {min && max && <div class="min-marker" style={{ left: `${minPercent}%` }} />}
      </div>

      {overflow > 0 && (
        <div class="progress-container overflow">
          <div class={`progress-bar ${barColor}`} style={{ width: `${Math.min(overflow, 100)}%` }} />
        </div>
      )}

      <div class="goal-targets">
        {min != null && <span class="target-label">Min: {formatTarget(min)}</span>}
        {max != null && <span class="target-label">Max: {formatTarget(max)}</span>}
      </div>
    </div>
  )
}

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
