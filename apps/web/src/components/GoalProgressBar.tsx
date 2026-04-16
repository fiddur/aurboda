import { metricUnits } from '@aurboda/api-spec'

import type { GoalProgress } from '../state/api'
import { metricLabels } from '../utils/metricLabels'

// Format value for display (e.g., seconds to hours:minutes)
export const formatValue = (metric: string, value: number): string => {
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
    return `${(value / 1000).toFixed(1)} km`
  }
  if (unit === 'count') {
    return value.toLocaleString()
  }
  return `${value.toLocaleString()} ${unit}`
}

// Format "losing tomorrow" value
export const formatLosingTomorrow = (metric: string, value: number): string => {
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
  compact?: boolean
}

// eslint-disable-next-line complexity -- handles both metric and trend goal types
export function GoalProgressBar({ goal, showWindow, compact }: GoalProgressBarProps) {
  const { current, max, min } = goal

  const label = goal.goal_type === 'trend' ? goal.pattern : (metricLabels[goal.metric] ?? goal.metric)
  const windowLabel = goal.goal_type === 'trend' ? goal.display_period : goal.window
  const valueText =
    goal.goal_type === 'trend'
      ? `${current.toFixed(2)} ${goal.display_unit}`
      : formatValue(goal.metric, current)
  const losingText =
    !compact && goal.goal_type === 'metric' ? formatLosingTomorrow(goal.metric, goal.losing_tomorrow) : ''

  const target = max ?? min ?? 1
  const progressPercent = (current / target) * 100
  const minPercent = min && max ? (min / max) * 100 : 100
  const overflow = progressPercent > 100 ? progressPercent - 100 : 0
  const cappedProgress = Math.min(progressPercent, 100)

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
