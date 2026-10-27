import {
  type ActivityMeasure,
  activityMeasureLabels,
  type DataSchemaDefinition,
  measureDefaultAggregation,
  type MeasureGoal,
  type MeasureGoalAggregation,
} from '@aurboda/api-spec'

import { categoricalItemFields, fieldLabel, itemPath, listFields } from '../components/sessions/sessionView'

type Item = Record<string, unknown>

const THIN_SPACE = ' '

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const groupThousands = (n: number): string =>
  String(Math.round(n)).replaceAll(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)

const formatKg = (n: number): string => `${Number(n.toFixed(1))} kg`

const formatSeconds = (seconds: number): string => {
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  return `${m}:${String(total % 60).padStart(2, '0')}`
}

export const formatMeasure = (measure: ActivityMeasure, value: number): string => {
  switch (measure) {
    case 'volume':
      return `${groupThousands(value)} kg`
    case 'e1rm':
    case 'max_weight':
      return formatKg(value)
    case 'set_count':
      return String(Math.round(value))
    case 'max_time':
      return formatSeconds(value)
    case 'total_reps':
    case 'max_reps':
      return `${Math.round(value)} reps`
  }
}

const SET_TYPE_FLAGS: Record<string, string> = { drop_set: ' (drop)', failure: ' (f)', warmup: ' (w)' }

/** One set as the Gravl sync writes it in the activity note: `8×80 kg (w)`. */
export const formatSet = (item: Item): string => {
  const reps = num(item.reps)
  const weight = num(item.weight)
  const time = num(item.time)
  const distance = num(item.distance)
  const parts: string[] = []
  if (reps !== undefined && weight !== undefined) parts.push(`${reps}×${weight} kg`)
  else if (reps !== undefined) parts.push(`${reps} reps`)
  else if (weight !== undefined) parts.push(`${weight} kg`)
  if (time !== undefined) parts.push(formatSeconds(time))
  if (distance !== undefined) parts.push(`${distance} m`)
  if (parts.length === 0) parts.push('—')
  const flag = typeof item.set_type === 'string' ? (SET_TYPE_FLAGS[item.set_type] ?? '') : ''
  return `${parts.join(' ')}${flag}`
}

export const formatSets = (items: Item[]): string => items.map(formatSet).join(', ')

const isWorking = (item: Item): boolean => String(item.set_type).trim().toLowerCase() !== 'warmup'

/** The first item with the highest score; scores are compared element by element, so later ones break ties. */
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
  const n = num(v)
  return n === undefined ? undefined : [n]
}

const longest = (items: Item[]): Item | undefined => maxBy(items, (i) => scoreOf(i.time))

/** The working set with the highest weight (more reps break a tie), else the most reps, else the longest time. */
export const topSet = (items: Item[]): Item | undefined => {
  const working = items.filter(isWorking)
  const heaviest = maxBy(working, (i) => {
    const weight = num(i.weight)
    return weight === undefined ? undefined : [weight, num(i.reps) ?? 0]
  })
  return heaviest ?? maxBy(working, (i) => scoreOf(i.reps)) ?? longest(working)
}

const epley = (item: Item): number | undefined => {
  const weight = num(item.weight)
  const reps = num(item.reps)
  return weight === undefined || reps === undefined || reps < 1 ? undefined : weight * (1 + reps / 30)
}

/** The working set a single-set measure came from; undefined for measures summed over sets. */
export const measureSet = (items: Item[], measure: ActivityMeasure): Item | undefined => {
  const working = items.filter(isWorking)
  switch (measure) {
    case 'e1rm':
      return maxBy(working, (i) => scoreOf(epley(i)))
    case 'max_weight':
      return topSet(items)
    case 'max_time':
      return longest(working)
    case 'max_reps':
      return maxBy(working, (i) => scoreOf(i.reps))
    case 'volume':
    case 'set_count':
    case 'total_reps':
      return undefined
  }
}

export const defaultAggregation = (measure: ActivityMeasure): MeasureGoalAggregation =>
  measureDefaultAggregation(measure)

export const measureGoalLabel = (
  goal: Pick<MeasureGoal, 'activity_type' | 'filter_value' | 'measure'> & { activity_type_name?: string },
  typeName?: string,
): string =>
  `${goal.filter_value ?? goal.activity_type_name ?? typeName ?? goal.activity_type} · ${activityMeasureLabels[goal.measure]}`

type WithSchema = { data_schema?: DataSchemaDefinition }

export const measurableTypes = <T extends WithSchema>(definitions: T[]): T[] =>
  definitions.filter((d) => listFields(d.data_schema).length > 0)

/** The item field a measure can be narrowed by, such as a strength session's exercise. */
export const measureFilter = (
  definition: WithSchema | undefined,
): { label: string; path: string } | undefined => {
  const first = categoricalItemFields(definition?.data_schema)[0]
  return first && { label: fieldLabel(first.item), path: itemPath(first.list, first.item) }
}

export const measureFilterPath = (definition: WithSchema | undefined): string | undefined =>
  measureFilter(definition)?.path
