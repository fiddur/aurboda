import type { ScreentimeCategory } from '@aurboda/api-spec'

import { format } from 'date-fns'

import type { Activity, Meal, Place } from '../../state/api'
import type { ChartItem, Column } from './types'

import { toDisplayName } from '../../utils/displayName'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { formatCollapsedTypesLine } from './activityMerge'
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
 * Match a derived activity's `activity_type` to the screentime category whose
 * `activity_type_name` slug it links to. Crucial after hierarchy collapse: a
 * `programming` + `software_dev` pair retyped to `work_dev` should display as
 * the "Work & Dev" category, not as the *first child's* category (which is
 * what path-based matching would return — `data.category_path` carries the
 * first member's path even after retype).
 */
const matchCategoryByActivityType = (
  activityType: string,
  categories: ScreentimeCategory[],
): ScreentimeCategory | undefined => categories.find((c) => c.activity_type_name === activityType)

/**
 * Categorize screentime activities into Screen Time lane items. Two paths:
 *
 *  • Legacy umbrella `activity_type='screentime'` activities carry the path
 *    as a string in `data.category_path`. The label is the leaf segment.
 *  • Derived-type activities (e.g. `programming`, `slack`, post-#651) are
 *    identified by `screentimeDerivedTypes`. They may carry `category_path`
 *    in data (set on the backend at sync time); if not, we fall back to the
 *    activity's display name. Hierarchy collapse may also produce synthetic
 *    parents whose `activity_type` is the top-level slug (e.g. `work`) — same
 *    treatment.
 *
 *  • A `collapsed_types` provenance attached by `collapseToParentType` is
 *    surfaced as a "Merged: X, Y" tooltip line via the shared
 *    `formatCollapsedTypesLine` helper.
 */
export const categorizeScreentimeActivities = (
  activities: Activity[],
  categories: ScreentimeCategory[],
  itemIcons: Record<string, string>,
  screentimeDerivedTypes: ReadonlySet<string>,
  typeDefsMap: ReadonlyMap<string, { display_name: string; color: string; icon?: string }>,
): ChartItem[] =>
  activities
    .filter((a): a is Activity & { end_time: Date } => Boolean(a.end_time))
    .filter((a) => a.activity_type === 'screentime' || screentimeDerivedTypes.has(a.activity_type))
    // eslint-disable-next-line complexity -- one fall-through pass over multiple label/color/icon sources
    .map((a) => {
      const categoryPathStr = typeof a.data?.category_path === 'string' ? a.data.category_path : ''
      const path = categoryPathStr ? categoryPathStr.split(' > ') : []
      const score = typeof a.data?.score === 'number' ? a.data.score : undefined

      // The "linked category" is the screentime_category whose
      // `activity_type_name` matches the activity's current type. After a
      // hierarchy collapse retyped this activity to its parent, this lookup
      // returns the parent category — exactly what we want for the bar's
      // identity. Falls back to walking the path for v1 umbrella activities
      // (activity_type='screentime' has no linked category).
      const matchedByType =
        a.activity_type !== 'screentime'
          ? matchCategoryByActivityType(a.activity_type, categories)
          : undefined
      const matchedByPath = matchCategoryByPath(path, categories)
      const linkedCategory = matchedByType ?? matchedByPath
      const def = a.activity_type !== 'screentime' ? typeDefsMap.get(a.activity_type) : undefined

      // Label / color / href / icon all key off the linked category — so a
      // collapsed bar renders as the parent it was retyped to, not as
      // whichever child happened to come first in `data.category_path`.
      const label = linkedCategory?.name.at(-1) ?? def?.display_name ?? path.at(-1) ?? 'Screen time'
      const color = linkedCategory?.color ?? def?.color ?? getProductivityColor(score)
      const href = linkedCategory ? `/screentime-categories/${linkedCategory.id}` : undefined
      const iconPath = linkedCategory?.name ?? path
      const icon = resolveCategoryIcon(iconPath, itemIcons) ?? def?.icon

      const mergedLine = formatCollapsedTypesLine(a.collapsed_types)
      const tooltipPath = linkedCategory?.name.join(' > ') ?? categoryPathStr ?? def?.display_name ?? ''
      const details = [
        tooltipPath,
        formatDuration(a.start_time, a.end_time),
        ...(mergedLine ? [mergedLine] : []),
      ].filter(Boolean)

      return {
        color,
        column: 'Screen Time' as Column,
        end: a.end_time,
        entity_id: linkedCategory ? undefined : a.id,
        entity_type: 'activity' as const,
        href,
        icon,
        isPoint: false,
        label,
        start: a.start_time,
        tooltip: {
          details,
          time: `${formatTime(a.start_time)} – ${formatTime(a.end_time)}`,
          title: label,
        },
      }
    })
