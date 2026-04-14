import type { ScreentimeCategory } from '@aurboda/api-spec'

import { format } from 'date-fns'

import type { Activity, Meal, Place, ProductivityRecord } from '../../state/api'
import type { ChartItem, Column } from './types'

import { toDisplayName } from '../../utils/displayName'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { getActivityColor, getPlaceColor, getResolvedColor, resolveCategoryIcon } from './colors'
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
        itemIcons[displayName] ??
        itemIcons[displayName.toLowerCase()] ??
        itemIcons[a.activity_type] ??
        typeDefsMap?.get(a.activity_type)?.icon
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

export const categorizeProductivity = (
  productivity: ProductivityRecord[],
  categories: ScreentimeCategory[],
  itemIcons: Record<string, string>,
): ChartItem[] =>
  productivity.map((record) => {
    const categoryPath = record.resolved_category?.join(' > ') ?? ''
    const label = record.resolved_category?.at(-1) ?? record.activity
    const apps = record.activity.split(', ')

    const href = record.category_id ? `/screentime-categories/${record.category_id}` : undefined

    return {
      color: getResolvedColor(record, categories),
      column: 'Screen Time' as Column,
      end: record.end_time,
      entity_id: record.category_id ? undefined : record.id,
      entity_type: 'productivity' as const,
      href,
      icon: resolveCategoryIcon(record.resolved_category, itemIcons),
      isPoint: false,
      label,
      start: record.start_time,
      tooltip: {
        details: [
          categoryPath,
          apps.length > 1 ? `Apps: ${record.activity}` : record.activity,
          record.title ? `Title: ${record.title}` : '',
          formatDuration(record.start_time, record.end_time),
        ].filter(Boolean),
        time: `${formatTime(record.start_time)} – ${formatTime(record.end_time)}`,
        title: label,
      },
    }
  })
