/**
 * Dimensions an activity's sessions can be broken down and filtered by: their length, their local
 * start time, sleep in the window around them, and a data field of the activity type. Sessions and
 * their windows are formed first, over every occurrence; a dimension then only selects among them.
 */
import {
  type ActivityTypeDefinition,
  IMPACT_NO_VALUE_KEY,
  type ImpactFilter,
  impactFieldPath,
} from '@aurboda/api-spec'

import { fieldValue, groupItemsByKey, listItems, parseFieldPath } from '../activity-measures.ts'
import { BIN_MINUTES, type Interval } from './impact.ts'
import { humanizeName } from './utils.ts'

const MINUTE_MS = 60_000

export interface Occurrence extends Interval {
  data?: Record<string, unknown>
}

export interface DimensionGroup {
  key: string
  label: string
}

export interface Classification {
  dimension: string
  label: string
  /** In group order; every bucket for duration and time_of_day, the non-empty groups otherwise. */
  groups: DimensionGroup[]
  /** keys[i] holds the group keys of session i. */
  keys: string[][]
}

export interface ClassifyContext {
  sessions: Interval[]
  members: Occurrence[][]
  windowMinutes: number
  tz: string
  sleeps: Interval[]
  durationLimits: number[]
  timeLimits: number[]
  fieldLabels: Map<string, string>
}

type Bucket<T> = DimensionGroup & { contains: (value: T) => boolean }

export const sessionMembers = (sessions: Interval[], occurrences: Occurrence[]): Occurrence[][] => {
  const members: Occurrence[][] = sessions.map(() => [])
  for (const occurrence of occurrences) {
    const i = sessions.findIndex((s) => occurrence.start >= s.start && occurrence.start <= s.end)
    if (i !== -1) members[i].push(occurrence)
  }
  return members
}

export const durationBuckets = (limits: number[]): Bucket<number>[] => {
  const bounds = [0, ...limits, Infinity]
  return bounds.slice(0, -1).map((lo, i) => {
    const hi = bounds[i + 1]
    const last = hi === Infinity
    return {
      contains: (minutes: number) => minutes >= lo && minutes < hi,
      key: last ? `${lo}-` : `${lo}-${hi}`,
      label: i === 0 ? `Under ${hi} min` : last ? `${lo} min or more` : `${lo}–${hi} min`,
    }
  })
}

const pad = (hour: number): string => String(hour).padStart(2, '0')

export const timeOfDayBuckets = (limits: number[]): Bucket<number>[] =>
  limits.map((from, i) => {
    const to = limits[(i + 1) % limits.length]
    return {
      contains: (hour: number) => (from < to ? hour >= from && hour < to : hour >= from || hour < to),
      key: `${from}-${to}`,
      label: `${pad(from)}–${to === 0 ? '24' : pad(to)}`,
    }
  })

const hourFormats = new Map<string, Intl.DateTimeFormat>()

export const localHourOfDay = (ms: number, tz: string): number => {
  const format = hourFormats.getOrInsertComputed(
    tz,
    () =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        minute: 'numeric',
        second: 'numeric',
        timeZone: tz,
      }),
  )
  const part = (type: string) =>
    Number(format.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? 0)
  return part('hour') + part('minute') / 60 + part('second') / 3600
}

const overlapMs = (a: Interval, b: Interval): number => Math.min(a.end, b.end) - Math.max(a.start, b.start)

export type SleepKey = 'none' | 'before' | 'after' | 'both'

export const sleepKey = (session: Interval, windowMinutes: number, sleeps: Interval[]): SleepKey => {
  const windowMs = windowMinutes * MINUTE_MS
  const touches = (range: Interval) =>
    sleeps.some((sleep) => overlapMs(sleep, range) >= BIN_MINUTES * MINUTE_MS)
  const before = touches({ end: session.start, start: session.start - windowMs })
  const after = touches({ end: session.end + windowMs, start: session.end })
  return before && after ? 'both' : before ? 'before' : after ? 'after' : 'none'
}

const SLEEP_GROUPS: DimensionGroup[] = [
  { key: 'none', label: 'No sleep in the window' },
  { key: 'before', label: 'Sleep before' },
  { key: 'after', label: 'Sleep after' },
  { key: 'both', label: 'Sleep before and after' },
]

const minutesOf = (s: Interval): number => (s.end - s.start) / MINUTE_MS

const classifyBuckets = <T>(
  dimension: string,
  label: string,
  buckets: Bucket<T>[],
  values: T[],
): Classification => ({
  dimension,
  groups: buckets.map((b) => ({ key: b.key, label: b.label })),
  keys: values.map((value) => buckets.filter((b) => b.contains(value)).map((b) => b.key)),
  label,
})

const occurringGroups = (groups: DimensionGroup[], keys: string[][]): DimensionGroup[] => {
  const present = new Set(keys.flat())
  return groups.filter((g) => present.has(g.key))
}

const countKeys = (keys: string[][], among: readonly number[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const i of among) for (const key of keys[i]) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}

const allIndices = (length: number): number[] => Array.from({ length }, (_, i) => i)

/** By count descending, then label; the no-value group last. */
export const orderFieldGroups = (groups: DimensionGroup[], counts: Map<string, number>): DimensionGroup[] =>
  groups.toSorted((a, b) => {
    if (a.key === IMPACT_NO_VALUE_KEY || b.key === IMPACT_NO_VALUE_KEY) {
      return Number(a.key === IMPACT_NO_VALUE_KEY) - Number(b.key === IMPACT_NO_VALUE_KEY)
    }
    return (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) || a.label.localeCompare(b.label)
  })

const valueLabel = (value: string | number | boolean): string =>
  typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)

const memberValues = (data: Record<string, unknown> | undefined, path: string): DimensionGroup[] => {
  const { field, key } = parseFieldPath(path)
  if (key !== undefined) {
    return groupItemsByKey(listItems(data, field), key).map((g) => ({ key: g.normalized, label: g.value }))
  }
  const value = fieldValue(data?.[field])
  return value === undefined ? [] : [{ key: String(value), label: valueLabel(value) }]
}

export const fieldLabel = (path: string, labels: Map<string, string>): string => {
  const { field, key } = parseFieldPath(path)
  return labels.get(path) ?? humanizeName(key ?? field)
}

const classifyField = (dimension: string, path: string, ctx: ClassifyContext): Classification => {
  const labels = new Map<string, string>()
  const keys = ctx.members.map((members) => {
    const values = new Set<string>()
    for (const member of members) {
      for (const { key, label } of memberValues(member.data, path)) {
        values.add(key)
        if (!labels.has(key)) labels.set(key, label)
      }
    }
    return values.size > 0 ? [...values] : [IMPACT_NO_VALUE_KEY]
  })
  if (keys.some((k) => k[0] === IMPACT_NO_VALUE_KEY)) labels.set(IMPACT_NO_VALUE_KEY, 'No value')
  const groups = [...labels].map(([key, label]) => ({ key, label }))
  return {
    dimension,
    groups: orderFieldGroups(groups, countKeys(keys, allIndices(keys.length))),
    keys,
    label: fieldLabel(path, ctx.fieldLabels),
  }
}

export const classify = (dimension: string, ctx: ClassifyContext): Classification => {
  if (dimension === 'duration') {
    return classifyBuckets(
      dimension,
      'Length',
      durationBuckets(ctx.durationLimits),
      ctx.sessions.map(minutesOf),
    )
  }
  if (dimension === 'time_of_day') {
    return classifyBuckets(
      dimension,
      'Time of day',
      timeOfDayBuckets(ctx.timeLimits),
      ctx.sessions.map((s) => localHourOfDay(s.start, ctx.tz)),
    )
  }
  if (dimension === 'sleep') {
    const keys = ctx.sessions.map((s) => [sleepKey(s, ctx.windowMinutes, ctx.sleeps)])
    return { dimension, groups: occurringGroups(SLEEP_GROUPS, keys), keys, label: 'Sleep in the window' }
  }
  const path = impactFieldPath(dimension)
  if (path === null) throw new Error(`Not an impact dimension: ${dimension}`)
  return classifyField(dimension, path, ctx)
}

export const passesFilters = (
  classifications: Classification[],
  filters: ImpactFilter[],
  i: number,
): boolean =>
  filters.every((filter) => {
    const keys = classifications.find((c) => c.dimension === filter.dimension)?.keys[i] ?? []
    return keys.some((key) => filter.keys.includes(key))
  })

export const groupCounts = (c: Classification, among?: readonly number[]): Map<string, number> =>
  countKeys(c.keys, among ?? allIndices(c.keys.length))

const isFixedBucketDimension = (dimension: string): boolean =>
  dimension === 'duration' || dimension === 'time_of_day'

/** The first `max` groups in order; the no-value group is kept and counts toward `max`. */
const capGroups = <G extends DimensionGroup>(groups: G[], max: number): G[] => {
  if (groups.length <= max) return groups
  const none = groups.find((g) => g.key === IMPACT_NO_VALUE_KEY)
  return none ? [...groups.filter((g) => g !== none).slice(0, max - 1), none] : groups.slice(0, max)
}

export interface GroupSelection extends DimensionGroup {
  indices: number[]
}

/** The non-empty groups among `selected`, capped, each with its session indices. */
export const breakdownGroups = (
  c: Classification,
  selected: readonly number[],
  max: number,
): { groups: GroupSelection[]; omitted: number } => {
  const counts = groupCounts(c, selected)
  const ordered = impactFieldPath(c.dimension) === null ? c.groups : orderFieldGroups(c.groups, counts)
  const nonEmpty = ordered.filter((g) => (counts.get(g.key) ?? 0) > 0)
  const kept = capGroups(nonEmpty, max)
  return {
    groups: kept.map((g) => ({ ...g, indices: selected.filter((i) => c.keys[i].includes(g.key)) })),
    omitted: nonEmpty.length - kept.length,
  }
}

export interface DimensionListing {
  dimension: string
  label: string
  groups: (DimensionGroup & { occurrences: number })[]
  omitted_groups: number
}

/** Every session counted, before filters. */
export const dimensionListing = (c: Classification, max: number): DimensionListing => {
  const counts = groupCounts(c)
  const groups = c.groups
    .map((g) => ({ ...g, occurrences: counts.get(g.key) ?? 0 }))
    .filter((g) => isFixedBucketDimension(c.dimension) || g.occurrences > 0)
  const kept = capGroups(groups, max)
  return { dimension: c.dimension, groups: kept, label: c.label, omitted_groups: groups.length - kept.length }
}

/** The categorical scalar fields and categorical item fields of a type, as field dimensions, in schema order. */
export const categoricalFieldDimensions = (definition: ActivityTypeDefinition | undefined): string[] =>
  (definition?.data_schema?.fields ?? []).flatMap((field) => {
    if (field.type !== 'list') return field.is_categorical ? [`field:${field.name}`] : []
    return (field.item_fields ?? [])
      .filter((item) => item.is_categorical)
      .map((item) => `field:${field.name}.${item.name}`)
  })

/** Labels of every field and item field a type's schema names, by path. */
export const schemaFieldLabels = (definition: ActivityTypeDefinition | undefined): Map<string, string> =>
  new Map(
    (definition?.data_schema?.fields ?? []).flatMap((field) => [
      ...(field.label ? [[field.name, field.label] as [string, string]] : []),
      ...(field.item_fields ?? []).flatMap((item) =>
        item.label ? [[`${field.name}.${item.name}`, item.label] as [string, string]] : [],
      ),
    ]),
  )
