import type { JournalContextItem } from '@aurboda/api-spec'

export type ContextKind = JournalContextItem['kind']

export const contextKindLabels: Record<ContextKind, string> = {
  days_since: 'Time since',
  metric: 'Metric',
  moon: 'Moon',
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
      return undefined
  }
}
