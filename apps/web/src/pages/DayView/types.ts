export type Column = 'Sleep / Rest' | 'Exercise' | 'Location' | 'Tags / Events' | 'Screen Time' | 'Music'

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
  entity_type?: 'activity' | 'tag' | 'productivity'
  href?: string
}
