import type { ScreentimeCategory } from '@aurboda/api-spec'

import { format } from 'date-fns'

import type { Activity, Meal, Place } from '../../state/api'
import type { ChartItem, Column } from './types'

import { toDisplayName } from '../../utils/displayName'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { getActivityColor, getPlaceColor, getProductivityColor, resolveCategoryIcon } from './colors'
import { formatDuration, formatTime } from './formatting'

export const categorizeLocations = (places: Place[], uniquePlaceNames: string[]): ChartItem[] =>
  places.map((p) => ({
    color: getPlaceColor(p.region, uniquePlaceNames),
    column: 'Location' as Column,
    end: p.end_time,
    href: `/places?date=${format(p.start_time, 'yyyy-MM-dd')}&name=${encodeURIComponent(p.region || '')}`,
    isPoint: false,
    label: p.region || 'Unknown',
    start: p.start_time,
    tooltip: {
      details: [formatDuration(p.start_time, p.end_time)],
      time: `${formatTime(p.start_time)} – ${formatTime(p.end_time)}`,
      title: p.region || 'Unknown',
    },
  }))

export const categorizeOtherActivities = (
  activities: Activity[],
  itemIcons: Record<string, string>,
  typeDefsMap?: Map<string, { icon?: string }>,
): ChartItem[] =>
  activities
    .filter((a) => a.source !== 'lastfm')
    .map((a) => {
      const isPoint = !a.end_time
      const end = a.end_time ?? new Date(a.start_time.getTime() + 15 * 60000)
      const sourceLabel = a.source ? ` (${a.source})` : ''
      const displayName = a.title ?? toDisplayName(a.activity_type)
      const icon =
        typeDefsMap?.get(a.activity_type)?.icon ??
        itemIcons[displayName] ??
        itemIcons[displayName.toLowerCase()] ??
        itemIcons[a.activity_type]
      return {
        color: getActivityColor(a),
        column: 'Activity' as Column,
        end,
        entity_id: a.id,
        entity_type: 'activity' as const,
        icon,
        isPoint,
        label: displayName,
        start: a.start_time,
        tooltip: {
          details: isPoint
            ? [`Point event${sourceLabel}`]
            : [formatDuration(a.start_time, end) + sourceLabel],
          time: isPoint ? formatTime(a.start_time) : `${formatTime(a.start_time)} – ${formatTime(end)}`,
          title: displayName,
        },
      }
    })

export const categorizeMeals = (meals: Meal[], itemIcons: Record<string, string>): ChartItem[] =>
  meals.flatMap((m) => {
    const mealIcon =
      resolveItemIcon(`meal:${m.meal_type ?? 'default'}`, itemIcons) ??
      resolveItemIcon('meal:default', itemIcons) ??
      '🍽️'
    const end = new Date(m.time.getTime() + 15 * 60000)
    const typeLabel = m.meal_type ? m.meal_type.charAt(0).toUpperCase() + m.meal_type.slice(1) : 'Meal'
    const details = [m.name, m.calories ? `${m.calories} kcal` : undefined].filter(Boolean) as string[]

    const foodItemIcons = (m.food_items ?? []).filter((fi) => fi.icon).map((fi) => fi.icon!)
    if (foodItemIcons.length > 0) {
      return foodItemIcons.map((fiIcon) => ({
        color: '#f59e0b',
        column: 'Activity' as Column,
        end,
        entity_id: m.id,
        entity_type: 'meal' as const,
        href: `/meals/${m.id}`,
        icon: fiIcon,
        isPoint: true,
        label: m.name ?? typeLabel,
        start: m.time,
        tooltip: {
          details: details.length > 0 ? details : [typeLabel],
          time: formatTime(m.time),
          title: `${fiIcon} ${typeLabel}`,
        },
      }))
    }

    return {
      color: '#f59e0b',
      column: 'Activity' as Column,
      end,
      entity_id: m.id,
      entity_type: 'meal' as const,
      href: `/meals/${m.id}`,
      icon: mealIcon,
      isPoint: true,
      label: m.name ?? typeLabel,
      start: m.time,
      tooltip: {
        details: details.length > 0 ? details : [typeLabel],
        time: formatTime(m.time),
        title: `${mealIcon} ${typeLabel}`,
      },
    }
  })

/**
 * Match a category-path array against the user's screentime categories,
 * walking from deepest match upward. Returns the most specific match (or
 * undefined if nothing in the path matches a defined category).
 */
const matchCategoryByPath = (
  path: string[],
  categories: ScreentimeCategory[],
): ScreentimeCategory | undefined => {
  for (let depth = path.length; depth > 0; depth--) {
    const sub = path.slice(0, depth)
    const match = categories.find((c) => c.name.length === sub.length && c.name.every((n, i) => n === sub[i]))
    if (match) return match
  }
  return undefined
}

/**
 * Categorize `screentime` activities into Screen Time lane items. The
 * underlying activity rows are pre-merged spans (one per category-source
 * window), so per-app names are not available in the tooltip — the lane
 * still shows category, time range, and duration.
 */
export const categorizeScreentimeActivities = (
  activities: Activity[],
  categories: ScreentimeCategory[],
  itemIcons: Record<string, string>,
): ChartItem[] =>
  activities
    .filter((a): a is Activity & { end_time: Date } =>
      Boolean(a.activity_type === 'screentime' && a.end_time),
    )
    .map((a) => {
      const categoryPathStr = typeof a.data?.category_path === 'string' ? a.data.category_path : ''
      const path = categoryPathStr ? categoryPathStr.split(' > ') : []
      const label = path.at(-1) ?? 'Screen time'
      const score = typeof a.data?.score === 'number' ? a.data.score : undefined

      const matched = matchCategoryByPath(path, categories)
      const color = matched?.color ?? getProductivityColor(score)
      const href = matched ? `/screentime-categories/${matched.id}` : undefined

      return {
        color,
        column: 'Screen Time' as Column,
        end: a.end_time,
        entity_id: matched ? undefined : a.id,
        entity_type: 'activity' as const,
        href,
        icon: resolveCategoryIcon(path, itemIcons),
        isPoint: false,
        label,
        start: a.start_time,
        tooltip: {
          details: [categoryPathStr, formatDuration(a.start_time, a.end_time)].filter(Boolean),
          time: `${formatTime(a.start_time)} – ${formatTime(a.end_time)}`,
          title: label,
        },
      }
    })
