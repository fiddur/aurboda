/**
 * Measures computed on read over a list field's items (a strength session's sets), by convention
 * on the item field names: `weight` and `reps` give volume and the Epley estimated one-rep max,
 * `time` gives the longest hold. Items with `set_type` = `warmup` do not count.
 */
import { z } from 'zod'

export const activityMeasures = [
  'volume',
  'e1rm',
  'max_weight',
  'set_count',
  'max_time',
  'total_reps',
  'max_reps',
] as const

export const activityMeasureSchema = z.enum(activityMeasures).meta({
  id: 'ActivityMeasure',
  description:
    'A measure over the items of a list field: volume = Σ weight × reps (kg), e1rm = max Epley weight × (1 + reps / 30) (kg), max_weight (kg), set_count, max_time = longest time (s), total_reps = Σ reps, max_reps = most reps in one item. Warmup sets are excluded.',
})

export type ActivityMeasure = z.infer<typeof activityMeasureSchema>

export const activityMeasureUnits: Record<ActivityMeasure, string> = {
  e1rm: 'kg',
  max_reps: 'reps',
  max_time: 's',
  max_weight: 'kg',
  set_count: '',
  total_reps: 'reps',
  volume: 'kg',
}

export const activityMeasureLabels: Record<ActivityMeasure, string> = {
  e1rm: 'Best e1RM',
  max_reps: 'Most reps in a set',
  max_time: 'Longest hold',
  max_weight: 'Max weight',
  set_count: 'Sets',
  total_reps: 'Total reps',
  volume: 'Volume',
}

/** Whether a window of sessions is scored by its best session (max) or its total (sum). */
export const measureDefaultAggregation = (measure: ActivityMeasure): 'max' | 'sum' =>
  measure === 'volume' || measure === 'set_count' || measure === 'total_reps' ? 'sum' : 'max'

/** Records are kept for the measures where a higher value means progress on one exercise. */
export const recordMeasures = [
  'e1rm',
  'max_weight',
  'max_time',
  'max_reps',
] as const satisfies readonly ActivityMeasure[]

export const activityMeasuresSchema = z
  .partialRecord(activityMeasureSchema, z.number())
  .meta({ id: 'ActivityMeasures', description: 'Measure values; a measure no item contributes to is absent' })

export type ActivityMeasures = z.infer<typeof activityMeasuresSchema>
