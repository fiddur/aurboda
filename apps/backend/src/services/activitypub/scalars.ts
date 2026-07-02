/**
 * Resolve the shared scalar-summary values for a feed post.
 *
 * Turns the user's chosen `included_metrics` keys into the `ScalarMetric[]` that
 * `buildCreateExercise` renders into `content` and `aurboda:metrics`. Pure and
 * dependency-injected: the caller supplies `metricStat`, an aggregate of a
 * metric over the shared activity's window (backed by `queryMetricsBucketed`
 * with a single window-sized bucket when wired to delivery). Only the requested
 * keys that are supported AND have data are emitted; everything else is skipped,
 * so a post never advertises a summary it can't back.
 */
import type { MetricType } from '../../schema.ts'
import type { ScalarMetric } from './object.ts'

export type ScalarStat = 'avg' | 'max' | 'sum'

/** Aggregate a metric over the activity window; `undefined` when there's no data. */
export type MetricStat = (metric: MetricType, stat: ScalarStat) => number | undefined

export interface ActivityWindow {
  startTime: Date
  endTime?: Date
}

const roundTo = (n: number, decimals = 0): number => {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** Scalar keys resolved from a single metric aggregate. */
const METRIC_SCALARS: Record<
  string,
  { metric: MetricType; stat: ScalarStat; unit?: string; label: string; transform?: (raw: number) => number }
> = {
  calories: {
    label: 'Calories',
    metric: 'calories_active',
    stat: 'sum',
    transform: (v) => roundTo(v),
    unit: 'kcal',
  },
  distance: {
    label: 'Distance',
    metric: 'distance',
    stat: 'sum',
    transform: (v) => roundTo(v / 1000, 2),
    unit: 'km',
  },
  heart_rate_avg: {
    label: 'Avg HR',
    metric: 'heart_rate',
    stat: 'avg',
    transform: (v) => roundTo(v),
    unit: 'bpm',
  },
  heart_rate_max: {
    label: 'Max HR',
    metric: 'heart_rate',
    stat: 'max',
    transform: (v) => roundTo(v),
    unit: 'bpm',
  },
  stress_avg: {
    label: 'Avg stress',
    metric: 'stress_level',
    stat: 'avg',
    transform: (v) => roundTo(v),
    unit: 'score',
  },
}

/** Build the `hr_zone_minutes` record (minutes per zone with data) from zone-second sums. */
const hrZoneMinutes = (metricStat: MetricStat): Record<string, number> => {
  const zones: Record<string, number> = {}
  for (let i = 0; i <= 5; i++) {
    const seconds = metricStat(`hr_zone_${i}_sec` as MetricType, 'sum')
    if (seconds !== undefined && seconds > 0) zones[`z${i}`] = Math.round(seconds / 60)
  }
  return zones
}

/**
 * Resolve the requested scalar keys into `ScalarMetric[]`, in the order given.
 * Supported keys: `duration`, `hr_zone_minutes`, plus the `METRIC_SCALARS` set
 * (`heart_rate_avg`/`heart_rate_max`, `stress_avg`, `distance`, `calories`).
 */
export const resolveSharedScalars = (
  window: ActivityWindow,
  includedMetrics: string[],
  metricStat: MetricStat,
): ScalarMetric[] => {
  const out: ScalarMetric[] = []
  for (const key of includedMetrics) {
    if (key === 'duration') {
      if (window.endTime) {
        const seconds = Math.round((window.endTime.getTime() - window.startTime.getTime()) / 1000)
        out.push({ key, label: 'Duration', unit: 'seconds', value: seconds })
      }
      continue
    }
    if (key === 'hr_zone_minutes') {
      const zones = hrZoneMinutes(metricStat)
      if (Object.keys(zones).length > 0) out.push({ key, label: 'HR zone minutes', value: zones })
      continue
    }
    const cfg = METRIC_SCALARS[key]
    if (cfg === undefined) continue
    const raw = metricStat(cfg.metric, cfg.stat)
    if (raw === undefined) continue
    out.push({ key, label: cfg.label, unit: cfg.unit, value: cfg.transform ? cfg.transform(raw) : raw })
  }
  return out
}
