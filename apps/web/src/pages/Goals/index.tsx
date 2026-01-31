import { metricUnits } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { fetchGoalsProgress, fetchUserSettings, type GoalProgress } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

// Friendly names for metrics
const metricLabels: Record<string, string> = {
  calories_active: 'Active Calories',
  calories_basal: 'Basal Calories',
  calories_total: 'Total Calories',
  distance: 'Distance',
  floors_climbed: 'Floors Climbed',
  heart_rate: 'Heart Rate',
  hr_zone_0_sec: 'Zone 0 (Below Z1)',
  hr_zone_1_sec: 'Zone 1',
  hr_zone_2_sec: 'Zone 2',
  hr_zone_3_sec: 'Zone 3',
  hr_zone_4_sec: 'Zone 4',
  hr_zone_5_sec: 'Zone 5',
  hrv_rmssd: 'HRV (RMSSD)',
  readiness_score: 'Readiness Score',
  resilience_score: 'Resilience Score',
  resting_heart_rate: 'Resting HR',
  sleep_score: 'Sleep Score',
  spo2: 'SpO2',
  steps: 'Steps',
  vo2_max: 'VO2 Max',
  weight: 'Weight',
}

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
}

function GoalProgressBar({ goal }: GoalProgressBarProps) {
  const { current, losingTomorrow, max, metric, min } = goal

  // Calculate progress percentages
  const target = max ?? min ?? 1
  const progressPercent = (current / target) * 100
  const minPercent = min && max ? (min / max) * 100 : 100
  const overflow = progressPercent > 100 ? progressPercent - 100 : 0
  const cappedProgress = Math.min(progressPercent, 100)

  // Determine bar color based on progress
  const getBarColor = () => {
    if (min && max) {
      // Min-max goal
      if (current >= max) return 'over-max'
      if (current >= min) return 'in-range'
      return 'below-min'
    }
    if (min) {
      // Min-only goal
      return current >= min ? 'met' : 'below-min'
    }
    if (max) {
      // Max-only goal
      return current > max ? 'over-max' : 'in-range'
    }
    return 'neutral'
  }

  const barColor = getBarColor()
  const losingText = formatLosingTomorrow(metric, losingTomorrow)

  return (
    <div class="goal-progress">
      <div class="goal-header">
        <span class="goal-label">{metricLabels[metric] ?? metric}</span>
        {losingText && <span class="losing-tomorrow">({losingText} tomorrow)</span>}
        <span class="goal-value">{formatValue(metric, current)}</span>
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
        {min && <span class="target-label">Min: {formatValue(metric, min)}</span>}
        {max && <span class="target-label">Max: {formatValue(metric, max)}</span>}
      </div>
    </div>
  )
}

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
        <p class="no-goals">
          No goals set. Visit <a href="/settings">Settings</a> to create goals.
        </p>
      </div>
    )
  }

  // Match progress data with goals
  const progressMap = new Map(goalsProgress?.map((p) => [p.id, p]) ?? [])

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
                  <span class="goal-label">{metricLabels[goal.metric] ?? goal.metric}</span>
                </div>
                <div class="progress-container">
                  <div class="progress-bar loading" style={{ width: '0%' }} />
                </div>
              </div>
            )
          }
          return <GoalProgressBar key={goal.id} goal={progress} />
        })}
      </div>

      <p class="goals-footer">
        Rolling {goals[0]?.window ?? '7d'} window from today. <a href="/settings">Edit goals</a>
      </p>
    </div>
  )
}
