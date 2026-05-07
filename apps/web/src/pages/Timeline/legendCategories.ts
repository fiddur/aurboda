import type { ActivityTypeDefinition } from '../../state/api'
import type { ChartItem, Column } from './types'

import { rootTypeOf } from './activityMerge'
import { tagSourceColors } from './colors'

/**
 * The Activity-side legend has a curated layer (sleep_rest / meditation /
 * exercise / other / calendar / meal) plus a `screentime` umbrella toggle and
 * — new in #718 — one dynamic sub-toggle per top-level screentime category
 * (e.g. `Work`, `Media`, `Comms`). Dynamic keys use the
 * `screentime:<top-level-slug>` namespace so they coexist with the static
 * union below.
 */
export type LegendCategory =
  // Top-level track toggles
  | 'music'
  | 'activity'
  | 'metrics'
  | 'location'
  // Activity sub-toggles (curated)
  | 'sleep_rest' // replaces sleep+nap+rest
  | 'meditation'
  | 'exercise'
  | 'other'
  | 'calendar'
  | 'meal'
  | 'screentime' // umbrella: legacy `screentime` activities + all derived screentime types
  // Metrics sub-toggles
  | 'hr'
  | 'hrv'
  | 'stress'
  | 'steps' // horizontal only
  | 'calories' // horizontal only
  | 'training_load' // horizontal only
  | 'screen_time_h' // horizontal only — screentime stacked bar
  // Dynamic per-top-level screentime category (e.g. "screentime:work").
  | `screentime:${string}`

// Legacy category names for URL hash backward compatibility.
export const LEGACY_CATEGORY_MAP: Record<string, LegendCategory> = {
  nap: 'sleep_rest',
  rest: 'sleep_rest',
  sleep: 'sleep_rest',
}

export const BASE_COLUMNS: Column[] = ['Activity', 'Location', 'Screen Time']

const SCREENTIME_SUB_PREFIX = 'screentime:' as const

/** A dynamic screentime sub-toggle key (one per top-level screentime category). */
export const screentimeSubKey = (topLevelSlug: string): LegendCategory =>
  `${SCREENTIME_SUB_PREFIX}${topLevelSlug}` as LegendCategory

/** True when a legend category is one of the dynamic screentime sub-toggles. */
export const isScreentimeSubKey = (cat: string): boolean => cat.startsWith(SCREENTIME_SUB_PREFIX)

const STATIC_CATEGORY_MATCHERS: Record<
  Exclude<LegendCategory, `screentime:${string}`>,
  (item: ChartItem) => boolean
> = {
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
  // The Screen Time column is the source of truth post-routing fix: legacy
  // `screentime` activities and all derived screentime types both land here.
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

/**
 * Top-level screentime categories visible in the legend, ordered as they
 * should appear. Built from the activity_type_definitions tree intersected
 * with the slugs that appear on at least one screentime_categories row, then
 * filtered to those whose `parent_type` is unset (the roots of each
 * category subtree).
 */
export interface ScreentimeSubEntry {
  /** The top-level activity_type slug (e.g. "work"). */
  type: string
  label: string
  color: string
  legendKey: LegendCategory
}

export const buildScreentimeSubEntries = (
  typeDefs: ActivityTypeDefinition[],
  screentimeDerivedTypes: ReadonlySet<string>,
): ScreentimeSubEntry[] =>
  typeDefs
    .filter((d) => screentimeDerivedTypes.has(d.name) && !d.parent_type && d.show_on_timeline !== false)
    .map((d) => ({
      color: d.color,
      label: d.display_name,
      legendKey: screentimeSubKey(d.name),
      type: d.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

/**
 * Build the matcher set including dynamic screentime sub-toggle entries.
 * Each `screentime:<top-level>` entry matches a Screen Time-column item whose
 * activity_type's root (via parent_type walk) equals the top-level slug.
 */
export const buildCategoryMatchers = (
  typeDefsMap: ReadonlyMap<string, { parent_type?: string }>,
  screentimeSubEntries: ScreentimeSubEntry[],
): Record<string, (item: ChartItem) => boolean> => {
  const matchers: Record<string, (item: ChartItem) => boolean> = { ...STATIC_CATEGORY_MATCHERS }
  for (const entry of screentimeSubEntries) {
    const topLevel = entry.type
    matchers[entry.legendKey] = (item) =>
      item.column === 'Screen Time' &&
      Boolean(item.activity_type) &&
      rootTypeOf(item.activity_type!, typeDefsMap) === topLevel
  }
  return matchers
}
