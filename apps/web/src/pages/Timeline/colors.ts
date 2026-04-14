import type { ScreentimeCategory } from '@aurboda/api-spec'

import type { Activity, ProductivityRecord } from '../../state/api'

// ── Color palettes ───────────────────────────────────────────────────────────

export const MUSIC_COLOR = '#ec4899'
export const TAG_COLOR = '#8b5cf6'
export const NOW_COLOR = '#ef4444'

export const activityColors: Record<string, string> = {
  meditation: '#a855f7',
  nap: '#60a5fa',
  rest: '#86efac',
  sleep: '#3b82f6',
}

export const hrZoneColors: Record<number, string> = {
  0: '#22c55e',
  1: '#22c55e',
  2: '#3b82f6',
  3: '#f59e0b',
  4: '#f97316',
  5: '#ef4444',
}

export const tagSourceColors: Record<string, string> = {
  calendar: '#f59e0b',
  default: TAG_COLOR,
  lastfm: '#ec4899',
  manual: TAG_COLOR,
  oura: TAG_COLOR,
}

export const productivityColors: Record<number, string> = {
  '-1': '#f97316',
  '-2': '#ef4444',
  0: '#9ca3af',
  1: '#3b82f6',
  2: '#22c55e',
}

export const placeColorPalette = [
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
]

// ── Color lookup functions ───────────────────────────────────────────────────

export const getPlaceColor = (name: string, allNames: string[]): string => {
  if (!name || name === 'Travel' || name === 'Unknown') return '#9ca3af'
  const index = allNames.indexOf(name)
  return placeColorPalette[index % placeColorPalette.length]!
}

export const getExerciseColor = (activity: Activity): string => {
  const zones = activity.hr_zone_secs
  if (!zones) return hrZoneColors[0]!
  let maxZone = 0
  let maxSecs = 0
  for (let z = 0; z <= 5; z++) {
    const secs = (zones as Record<number, number>)[z] ?? 0
    if (secs > maxSecs) {
      maxSecs = secs
      maxZone = z
    }
  }
  return hrZoneColors[maxZone] ?? hrZoneColors[0]!
}

export const getActivityColor = (activity: Activity): string =>
  tagSourceColors[activity.source ?? 'default'] ?? tagSourceColors.default!

export const getProductivityColor = (score: number | undefined): string =>
  productivityColors[score ?? 0] ?? productivityColors[0]!

export const getResolvedColor = (p: ProductivityRecord, categories: ScreentimeCategory[]): string => {
  if (p.resolved_category && p.resolved_category.length > 0 && categories.length > 0) {
    for (let depth = p.resolved_category.length; depth > 0; depth--) {
      const path = p.resolved_category.slice(0, depth)
      const match = categories.find(
        (c) => c.name.length === path.length && c.name.every((n, i) => n === path[i]),
      )
      if (match?.color) return match.color
    }
  }
  return getProductivityColor(p.productivity)
}

export const resolveCategoryIcon = (
  resolvedCategory: string[] | undefined,
  itemIcons: Record<string, string>,
): string | undefined => {
  if (!resolvedCategory || resolvedCategory.length === 0) return undefined
  for (let depth = resolvedCategory.length; depth > 0; depth--) {
    const path = resolvedCategory.slice(0, depth).join(' > ')
    const icon = itemIcons[`category:${path}`]
    if (icon) return icon
  }
  return undefined
}
