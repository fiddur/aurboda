export type Column =
  | 'Activity'
  | 'Sleep / Rest'
  | 'Exercise'
  | 'Location'
  | 'Tags / Events'
  | 'Screen Time'
  | 'Music'

export type Orientation = 'horizontal' | 'vertical'

export interface TooltipContent {
  title: string
  time: string
  details: string[]
}

export interface ChartItem {
  column: Column
  start: Date
  end: Date
  label: string
  color: string
  tooltip: TooltipContent
  isPoint: boolean
  entity_id?: string
  entity_type?: 'activity' | 'tag' | 'productivity' | 'metric'
  href?: string
  /** Activity type for sparkline overlay targeting */
  activity_type?: 'sleep' | 'nap' | 'meditation' | 'exercise'
  /** Emoji or icon URL to render instead of the default point marker */
  icon?: string
}
