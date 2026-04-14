import type { ChartItem, Column } from './types'

import { tagSourceColors } from './colors'

// Top-level track toggles + sub-toggles, all stored in one flat Set.
export type LegendCategory =
  // Top-level track toggles
  | 'music'
  | 'activity'
  | 'metrics'
  | 'location'
  // Activity sub-toggles
  | 'sleep_rest' // replaces sleep+nap+rest
  | 'meditation'
  | 'exercise'
  | 'other'
  | 'calendar'
  | 'meal'
  | 'screentime' // vertical only
  // Metrics sub-toggles
  | 'hr'
  | 'hrv'
  | 'stress'
  | 'steps' // horizontal only
  | 'calories' // horizontal only
  | 'training_load' // horizontal only
  | 'screen_time_h' // horizontal only — screentime stacked bar

// Legacy category names for URL hash backward compatibility
export const LEGACY_CATEGORY_MAP: Record<string, LegendCategory> = {
  nap: 'sleep_rest',
  rest: 'sleep_rest',
  sleep: 'sleep_rest',
}

export const BASE_COLUMNS: Column[] = ['Activity', 'Location', 'Screen Time']

export const CATEGORY_MATCHERS: Record<LegendCategory, (item: ChartItem) => boolean> = {
  activity: (item) => item.column === 'Activity' || item.column === 'Screen Time',
  calendar: (item) => item.column === 'Activity' && item.color === tagSourceColors.calendar,
  calories: () => false, // metrics sub-toggles handled at draw level
  exercise: (item) => item.column === 'Activity' && item.activity_type === 'exercise',
  hr: () => false,
  hrv: () => false,
  stress: () => false,
  location: (item) => item.column === 'Location',
  meal: (item) => item.entity_type === 'meal',
  meditation: (item) => item.column === 'Activity' && item.activity_type === 'meditation',
  metrics: () => false, // metrics track controlled via sub-toggles at draw level
  music: (item) => item.column === 'Music',
  screentime: (item) => item.column === 'Screen Time',
  sleep_rest: (item) =>
    item.column === 'Activity' && ['sleep', 'nap', 'rest'].includes(item.activity_type ?? ''),
  steps: () => false,
  other: (item) =>
    item.column === 'Activity' &&
    item.entity_type === 'activity' &&
    item.color !== tagSourceColors.calendar &&
    !item.activity_type,
  screen_time_h: () => false, // horizontal screentime bar controlled at draw level
  training_load: () => false,
}
