/**
 * Measures over the items of a list field (a strength session's sets), computed on read from
 * `data` by convention on the item field names: `weight` × `reps` gives volume and the Epley
 * estimated one-rep max, `reps` alone the total and the best set, `time` the longest hold.
 * Items with `set_type` = warmup don't count.
 */
import {
  type ActivityMeasure,
  type ActivityMeasures,
  type ActivityTypeDefinition,
  recordMeasures,
} from '@aurboda/api-spec'

type Item = Record<string, unknown>

export interface ItemGroup {
  value: string
  normalized: string
  items: Item[]
}

export const parseFieldPath = (path: string): { field: string; key?: string } => {
  const dot = path.indexOf('.')
  return dot === -1 ? { field: path } : { field: path.slice(0, dot), key: path.slice(dot + 1) }
}

export const normalizeItemValue = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined
  const normalized = String(v).trim().toLowerCase()
  return normalized === '' ? undefined : normalized
}

const isObject = (v: unknown): v is Item => typeof v === 'object' && v !== null && !Array.isArray(v)

export const listItems = (data: Record<string, unknown> | undefined, field: string): Item[] => {
  const list = data?.[field]
  return Array.isArray(list) ? list.filter(isObject) : []
}

export const matchingItems = (
  data: Record<string, unknown> | undefined,
  field: string,
  key: string,
  normalized: string,
): Item[] => listItems(data, field).filter((item) => normalizeItemValue(item[key]) === normalized)

export const listFieldOf = (definitions: ActivityTypeDefinition[], types: string[]): string | undefined =>
  definitions
    .filter((d) => types.includes(d.name))
    .flatMap((d) => d.data_schema?.fields ?? [])
    .find((f) => f.type === 'list')?.name

export const isWorkingItem = (item: Item): boolean =>
  !(typeof item.set_type === 'string' && item.set_type.trim().toLowerCase() === 'warmup')

const positive = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined

const round1 = (v: number): number => Math.round(v * 10) / 10

const maxOf = (values: number[]): number | undefined => (values.length > 0 ? Math.max(...values) : undefined)

const withoutAbsent = (m: Partial<Record<ActivityMeasure, number | undefined>>): ActivityMeasures =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as ActivityMeasures

export const measureItems = (items: Item[]): ActivityMeasures => {
  const working = items.filter(isWorkingItem)
  if (working.length === 0) return {}
  const loaded = working.flatMap((item) => {
    const weight = positive(item.weight)
    const reps = positive(item.reps)
    return weight !== undefined && reps !== undefined ? [{ reps, weight }] : []
  })
  const e1rm = maxOf(loaded.map(({ reps, weight }) => weight * (1 + reps / 30)))
  const repCounts = working.flatMap((item) => positive(item.reps) ?? [])
  return withoutAbsent({
    e1rm: e1rm === undefined ? undefined : round1(e1rm),
    max_reps: maxOf(repCounts),
    max_time: maxOf(working.flatMap((item) => positive(item.time) ?? [])),
    max_weight: maxOf(working.flatMap((item) => positive(item.weight) ?? [])),
    set_count: working.length,
    total_reps: repCounts.length > 0 ? repCounts.reduce((sum, r) => sum + r, 0) : undefined,
    volume: loaded.length > 0 ? loaded.reduce((sum, { reps, weight }) => sum + weight * reps, 0) : undefined,
  })
}

const summed: readonly ActivityMeasure[] = ['volume', 'set_count', 'total_reps']

export const combineMeasures = (list: ActivityMeasures[]): ActivityMeasures => {
  const combined: ActivityMeasures = {}
  for (const measures of list) {
    for (const [name, value] of Object.entries(measures) as [ActivityMeasure, number][]) {
      const prev = combined[name]
      combined[name] =
        prev === undefined ? value : summed.includes(name) ? prev + value : Math.max(prev, value)
    }
  }
  return combined
}

/** Items grouped by their normalised `key` value, in order of first appearance; items without one are dropped. */
export const groupItemsByKey = (items: Item[], key: string): ItemGroup[] => {
  const groups = new Map<string, ItemGroup>()
  for (const item of items) {
    const normalized = normalizeItemValue(item[key])
    if (normalized === undefined) continue
    groups
      .getOrInsertComputed(normalized, () => ({ items: [], normalized, value: String(item[key]).trim() }))
      .items.push(item)
  }
  return [...groups.values()]
}

/** The record measures `current` beats in every earlier session; with none earlier, each present one. */
export const recordsFor = (current: ActivityMeasures, earlier: ActivityMeasures[]): ActivityMeasure[] =>
  recordMeasures.filter((m) => {
    const value = current[m]
    return value !== undefined && earlier.every((e) => e[m] === undefined || value > e[m])
  })

const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** The first item with the highest score; scores compare element by element, so later ones break ties. */
const maxBy = (items: Item[], score: (item: Item) => number[] | undefined): Item | undefined => {
  let best: Item | undefined
  let bestScore: number[] = []
  for (const item of items) {
    const s = score(item)
    if (s === undefined) continue
    const diff = s.map((v, i) => v - (bestScore[i] ?? -Infinity)).find((d) => d !== 0) ?? 0
    if (best === undefined || diff > 0) {
      best = item
      bestScore = s
    }
  }
  return best
}

const scoreOf = (v: unknown): number[] | undefined => {
  const n = finite(v)
  return n === undefined ? undefined : [n]
}

const epley = (item: Item): number | undefined => {
  const weight = finite(item.weight)
  const reps = finite(item.reps)
  return weight === undefined || reps === undefined || reps < 1 ? undefined : weight * (1 + reps / 30)
}

/**
 * The working set a single-set measure came from; undefined for measures summed over sets. Mirrors the web's
 * `measureSet`, so a public page names the same set as the owner's.
 */
export const measureSet = (items: Item[], measure: ActivityMeasure): Item | undefined => {
  const working = items.filter(isWorkingItem)
  switch (measure) {
    case 'e1rm':
      return maxBy(working, (i) => scoreOf(epley(i)))
    case 'max_weight':
      return (
        maxBy(working, (i) => {
          const weight = finite(i.weight)
          return weight === undefined ? undefined : [weight, finite(i.reps) ?? 0]
        }) ??
        maxBy(working, (i) => scoreOf(i.reps)) ??
        maxBy(working, (i) => scoreOf(i.time))
      )
    case 'max_time':
      return maxBy(working, (i) => scoreOf(i.time))
    case 'max_reps':
      return maxBy(working, (i) => scoreOf(i.reps))
    case 'volume':
    case 'set_count':
    case 'total_reps':
      return undefined
  }
}
