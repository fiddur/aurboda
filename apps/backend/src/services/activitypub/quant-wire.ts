/**
 * The QuantPub wire boundary (`docs/fep/quantpub.md`). Aurboda keeps its metric
 * names and scalar keys snake_case internally; the `0.2` wire payload is
 * lowerCamelCase. Inbound documents from `0.1` peers are normalised to `0.2`
 * before schema validation.
 */
import type { MetricType } from '@aurboda/api-spec'

import { validMetrics } from '@aurboda/api-spec'

export const toWireKey = (snake: string): string =>
  snake.replaceAll(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())

/**
 * Not a full inverse of `toWireKey`: a segment that starts with a digit is
 * ambiguous (`spo2` vs `hr_zone_2_sec`), so metric types are resolved by
 * `wireMetricToMetricType` instead.
 */
export const fromWireKey = (camel: string): string => camel.replaceAll(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

const metricTypeByWireKey: ReadonlyMap<string, MetricType> = new Map(
  validMetrics.map((m) => [toWireKey(m), m] as const),
)

export const wireMetricToMetricType = (key: string): MetricType | null =>
  metricTypeByWireKey.get(toWireKey(key)) ?? null

type JsonRecord = Record<string, unknown>

const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v)

const LEGACY_FIELDS: Readonly<Record<string, string | null>> = {
  activity_type: 'activityType',
  duration_seconds: null,
  end_time: 'endTime',
  start_time: 'startTime',
  title: 'name',
}

const convertEntries = (list: unknown, field: 'key' | 'metric'): { changed: boolean; value: unknown } => {
  if (!Array.isArray(list)) return { changed: false, value: list }
  let changed = false
  const value = list.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry[field] !== 'string') return entry
    const wire = toWireKey(entry[field])
    if (wire === entry[field]) return entry
    changed = true
    return { ...entry, [field]: wire }
  })
  return { changed, value }
}

/** Convert a `0.1` activity payload to `0.2`; anything else (including `0.2`) is returned as is. */
export const normalizeStructuredActivity = (input: unknown): unknown => {
  if (!isRecord(input)) return input
  if (input.kind !== undefined && input.kind !== 'activity') return input
  let changed = false
  const out: JsonRecord = {}
  for (const [k, v] of Object.entries(input)) {
    if (Object.hasOwn(LEGACY_FIELDS, k)) {
      changed = true
      const renamed = LEGACY_FIELDS[k]
      if (renamed !== null && renamed !== undefined) out[renamed] = v
    } else {
      out[k] = v
    }
  }
  const metrics = convertEntries(out.metrics, 'key')
  const series = convertEntries(out.series, 'metric')
  if (!changed && !metrics.changed && !series.changed) return input
  if (metrics.changed) out.metrics = metrics.value
  if (series.changed) out.series = series.value
  return out
}

/** Convert a `0.1` discovery document (`api_base`) to `0.2` (`apiBase`). */
export const normalizeWellKnownQuantpub = (input: unknown): unknown => {
  if (!isRecord(input) || !('api_base' in input)) return input
  const { api_base: apiBase, ...rest } = input
  return { apiBase, ...rest }
}
