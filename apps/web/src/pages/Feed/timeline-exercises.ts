import type { ActivityMeasure, FeedStructuredExercise } from '@aurboda/api-spec'

import { activityMeasures } from '@aurboda/api-spec'

import { fromWireKey } from '../../components/feed-metrics'
import { formatMeasure, formatSet, recordBadge } from '../../utils/measures'

export interface ExerciseRow {
  name: string
  /** `PR e1RM`, one per record the session set. */
  badges: { label: string; measure: ActivityMeasure }[]
  /** One entry per set: `12×5 kg (w)`, `10×10 kg`. */
  sets: string[]
  /** `e1RM 15.2 kg`, `volume 296 kg`; empty without either. */
  summary: string[]
}

const asMeasure = (wireKey: string): ActivityMeasure | undefined => {
  const key = fromWireKey(wireKey)
  return (activityMeasures as readonly string[]).includes(key) ? (key as ActivityMeasure) : undefined
}

const SUMMARY_LABELS: [ActivityMeasure, string][] = [
  ['e1rm', 'e1RM'],
  ['volume', 'volume'],
]

/** A shared exercise as the card shows it, in the same notation as the federated Note. */
export const exerciseRow = (exercise: FeedStructuredExercise): ExerciseRow => {
  const values = new Map<ActivityMeasure, number>()
  for (const metric of exercise.metrics) {
    const measure = asMeasure(metric.key)
    if (measure !== undefined && typeof metric.value === 'number') values.set(measure, metric.value)
  }
  const summary = SUMMARY_LABELS.flatMap(([measure, label]) => {
    const value = values.get(measure)
    return value === undefined ? [] : [`${label} ${formatMeasure(measure, value)}`]
  })
  const badges = (exercise.records ?? []).flatMap((key) => {
    const measure = asMeasure(key)
    return measure === undefined ? [] : [{ label: recordBadge(measure), measure }]
  })
  const sets = exercise.sets.map(({ setType, ...rest }) =>
    formatSet(setType === undefined ? rest : { ...rest, set_type: setType }),
  )
  return { badges, name: exercise.name, sets, summary }
}
