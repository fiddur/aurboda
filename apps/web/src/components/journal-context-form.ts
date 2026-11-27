import {
  isContextualHrvMetric,
  isHrZoneMetric,
  isJournalContextDerivedMetric,
  type JournalContextItem,
  type MetricType,
} from '@aurboda/api-spec'

import { isEmoji, resolveItemIcon, suggestEmoji } from '../utils/emojiLookup'

export type ContextKind = JournalContextItem['kind']

export const contextKindLabels: Record<ContextKind, string> = {
  days_since: 'Time since',
  metric: 'Metric',
  moon: 'Moon',
  training_load: 'Training load',
  trend: 'Trend',
}

/** `c1`, `c2`, …: the first one no item has. */
export const nextItemId = (items: readonly JournalContextItem[]): string => {
  const taken = new Set(items.map((item) => item.id))
  let n = 1
  while (taken.has(`c${n}`)) n++
  return `c${n}`
}

/** An item of `kind` keeping the id, label and decimals of `from`; the kind's own fields start empty. */
export const withKind = (
  from: Pick<JournalContextItem, 'decimals' | 'id' | 'label'>,
  kind: ContextKind,
): JournalContextItem => {
  const base = { decimals: from.decimals, id: from.id, label: from.label }
  switch (kind) {
    case 'metric':
      return { ...base, kind, metric: '', missing: 'hide' }
    case 'trend':
      return { ...base, kind, pattern: '', source_type: 'activity_type' }
    case 'days_since':
      return { ...base, kind, source_type: 'activity_type', unit: 'days' }
    case 'moon':
      return { ...base, kind, value: 'illumination' }
    case 'training_load':
      return { ...base, kind, value: 'ctl' }
  }
}

type DaysSinceItem = Extract<JournalContextItem, { kind: 'days_since' }>

/** `item` counting from `source`, without the field the other sources use (`pattern` for a date, else `date`). */
export const withDaysSinceSource = (
  item: DaysSinceItem,
  source: DaysSinceItem['source_type'],
): DaysSinceItem => {
  const { date, pattern, ...rest } = item
  return source === 'date'
    ? { ...rest, source_type: source, ...(date === undefined ? {} : { date }) }
    : { ...rest, source_type: source, ...(pattern === undefined ? {} : { pattern }) }
}

export const addItem = (items: readonly JournalContextItem[], kind: ContextKind): JournalContextItem[] => [
  ...items,
  withKind({ decimals: 0, id: nextItemId(items), label: '' }, kind),
]

/** The list with the item at `index` swapped with its neighbour `by` (-1 up, 1 down); unchanged at an end. */
export const moveItem = (
  items: readonly JournalContextItem[],
  index: number,
  by: -1 | 1,
): JournalContextItem[] => {
  const target = index + by
  if (target < 0 || target >= items.length) return [...items]
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export const replaceItem = (
  items: readonly JournalContextItem[],
  index: number,
  item: JournalContextItem,
): JournalContextItem[] => items.map((current, i) => (i === index ? item : current))

export const removeItem = (items: readonly JournalContextItem[], index: number): JournalContextItem[] =>
  items.filter((_, i) => i !== index)

/** What keeps an item from being saved, or undefined when it can be. */
export const itemProblem = (item: JournalContextItem): string | undefined => {
  switch (item.kind) {
    case 'metric':
      return item.metric ? undefined : 'Choose a metric'
    case 'trend':
      return item.pattern ? undefined : 'Choose what to trend'
    case 'days_since':
      if (item.source_type === 'date') return item.date ? undefined : 'Choose a date'
      return item.pattern ? undefined : 'Choose an activity type or tag'
    case 'moon':
    case 'training_load':
      return undefined
  }
}

type MetricItem = Extract<JournalContextItem, { kind: 'metric' }>

/** Whether the server reads a metric item's `source`: not for metrics computed from every source. */
export const metricHasSource = (metric: string): boolean =>
  metric !== 'zone2_weekly' &&
  !isHrZoneMetric(metric as MetricType) &&
  !isContextualHrvMetric(metric as MetricType)

/** Whether a metric item's `missing: carry_forward` means anything: not for a figure over a window. */
export const metricCarriesForward = (metric: string): boolean =>
  !isJournalContextDerivedMetric(metric) &&
  !isHrZoneMetric(metric as MetricType) &&
  !isContextualHrvMetric(metric as MetricType)

/** `item` showing `metric`, without the options the server ignores for it. */
export const withMetric = (item: MetricItem, metric: string): MetricItem => {
  const { source, ...rest } = item
  return {
    ...rest,
    metric,
    missing: metricCarriesForward(metric) ? item.missing : 'hide',
    ...(source !== undefined && metricHasSource(metric) ? { source } : {}),
  }
}

/** What closing the editor saves: the complete items, leaving out any that are still incomplete. */
export const itemsToSaveOnClose = (items: readonly JournalContextItem[]): JournalContextItem[] =>
  items.filter((item) => itemProblem(item) === undefined)

export type AutosaveStep =
  | { action: 'none' }
  | { action: 'blocked'; problem: string }
  | { action: 'wait' }
  | { action: 'save'; items: JournalContextItem[] }

/**
 * What the autosave does with `items` now: nothing when they are what the server has (`saved`, as JSON), hold
 * on an incomplete item, wait for the save in flight (a follow-up runs when it is done), else save them.
 */
export const autosaveStep = (items: JournalContextItem[], saved: string, saving: boolean): AutosaveStep => {
  if (JSON.stringify(items) === saved) return { action: 'none' }
  const problem = items.map(itemProblem).find((p) => p !== undefined)
  if (problem !== undefined) return { action: 'blocked', problem }
  if (saving) return { action: 'wait' }
  return { action: 'save', items }
}

export interface IconSources {
  /** The user's `item_icons` setting. */
  itemIcons: Record<string, string>
  /** Activity type name → the icon of its definition. */
  typeIcons: ReadonlyMap<string, string | undefined>
}

const emojiOnly = (icon: string | undefined): string | undefined =>
  icon !== undefined && isEmoji(icon) ? icon.trim() : undefined

/** The emoji the app shows for an activity type or tag, as the timeline picks it. */
const patternIcon = (pattern: string, { itemIcons, typeIcons }: IconSources): string | undefined =>
  emojiOnly(resolveItemIcon(pattern, itemIcons)) ??
  emojiOnly(resolveItemIcon(`activity:${pattern}`, itemIcons)) ??
  emojiOnly(typeIcons.get(pattern)) ??
  suggestEmoji(pattern)

/** The label suggested for the data `item` shows, when there is an emoji for it. */
export const suggestedLabel = (item: JournalContextItem, icons: IconSources): string | undefined => {
  switch (item.kind) {
    case 'metric':
      return item.metric ? suggestEmoji(item.metric) : undefined
    case 'trend':
      if (!item.pattern) return undefined
      return item.source_type === 'metric' ? suggestEmoji(item.pattern) : patternIcon(item.pattern, icons)
    case 'days_since':
      return item.source_type === 'date' || !item.pattern ? undefined : patternIcon(item.pattern, icons)
    case 'moon':
    case 'training_load':
      return undefined
  }
}

/** What an item shows, as far as its label suggestion goes. */
const dataKey = (item: JournalContextItem): string =>
  JSON.stringify([
    item.kind,
    'source_type' in item ? item.source_type : undefined,
    'pattern' in item ? item.pattern : undefined,
    'metric' in item ? item.metric : undefined,
  ])

/**
 * `next` with its label suggested from its data when this edit changed the data and the user did not type the
 * label: a label that is empty, or still the suggestion for `previous`, follows the suggestion for `next` (empty
 * when there is none). Any other edit leaves the label as it is.
 */
export const withSuggestedLabel = (
  previous: JournalContextItem,
  next: JournalContextItem,
  icons: IconSources,
): JournalContextItem => {
  if (next.label !== previous.label || dataKey(next) === dataKey(previous)) return next
  const before = suggestedLabel(previous, icons)
  if (next.label !== '' && next.label !== before) return next
  const label = suggestedLabel(next, icons) ?? ''
  return label === next.label ? next : { ...next, label }
}
