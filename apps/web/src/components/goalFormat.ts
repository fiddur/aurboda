import { type Goal, type GoalProgress, metricUnits } from '@aurboda/api-spec'

import { formatMeasure, measureGoalLabel } from '../utils/measures'
import { metricLabels } from '../utils/metricLabels'

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

export interface GoalFormat {
  label: string
  windowLabel: string
  format: (value: number) => string
  /** What drops off the window tomorrow, '' for nothing (always for trends). */
  losingTomorrow: string
}

export const goalFormat = (progress: GoalProgress): GoalFormat => {
  switch (progress.goal_type) {
    case 'trend':
      return {
        format: (v) => `${v.toFixed(2)} ${progress.display_unit}`,
        label: progress.pattern,
        losingTomorrow: '',
        windowLabel: progress.display_period,
      }
    case 'metric':
      return {
        format: (v) => formatValue(progress.metric, v),
        label: metricLabels[progress.metric] ?? progress.metric,
        losingTomorrow: formatLosingTomorrow(progress.metric, progress.losing_tomorrow),
        windowLabel: progress.window,
      }
    case 'measure':
      return {
        format: (v) => formatMeasure(progress.measure, v),
        label: measureGoalLabel(progress),
        losingTomorrow:
          progress.losing_tomorrow === 0
            ? ''
            : `-${formatMeasure(progress.measure, progress.losing_tomorrow)}`,
        windowLabel: progress.window,
      }
  }
}

export const goalLabel = (goal: Goal): string => {
  switch (goal.goal_type) {
    case 'trend':
      return goal.pattern
    case 'metric':
      return metricLabels[goal.metric] ?? goal.metric
    case 'measure':
      return measureGoalLabel(goal)
  }
}

/** Formats a goal's history values; `unit` is the history's, which trends display with. */
export const goalValueFormat = (goal: Goal, unit?: string): ((value: number) => string) => {
  switch (goal.goal_type) {
    case 'trend':
      return (v) => `${v.toFixed(2)} ${unit ?? ''}`.trim()
    case 'metric':
      return (v) => formatValue(goal.metric, v)
    case 'measure':
      return (v) => formatMeasure(goal.measure, v)
  }
}
