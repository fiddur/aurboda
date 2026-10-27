import type { GoalProgress } from '../state/api'

import { goalFormat } from './goalFormat'

interface GoalProgressBarProps {
  goal: GoalProgress
  showWindow?: boolean
  compact?: boolean
}

export function GoalProgressBar({ goal, showWindow, compact }: GoalProgressBarProps) {
  const { current, max, min } = goal

  const { format, label, losingTomorrow, windowLabel } = goalFormat(goal)
  const valueText = format(current)
  const losingText = compact ? '' : losingTomorrow

  const target = max ?? min ?? 1
  const progressPercent = (current / target) * 100
  const minPercent = min && max ? (min / max) * 100 : 100
  const overflow = progressPercent > 100 ? progressPercent - 100 : 0
  const cappedProgress = Math.min(progressPercent, 100)

  const getBarColor = () => {
    if (min && max) {
      if (current > max) return 'over-max'
      if (current >= min) return 'in-range'
      return 'below-min'
    }
    if (min) return current >= min ? 'met' : 'below-min'
    if (max) return current > max ? 'over-max' : 'in-range'
    return 'neutral'
  }

  const barColor = getBarColor()

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
        {min != null && <span class="target-label">Min: {format(min)}</span>}
        {max != null && <span class="target-label">Max: {format(max)}</span>}
      </div>
    </div>
  )
}
