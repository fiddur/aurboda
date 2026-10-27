import { activityMeasureLabels, type ChallengeSpec } from '@aurboda/api-spec'

import { formatMeasure } from '../../utils/measures'

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

/** What a challenge scores, in a line: `Push-ups · most reps in a set (best session)`. */
export const describeSpec = (spec: ChallengeSpec): string => {
  if (!spec.measure) return `${spec.pattern} · ${spec.aggregation}`
  const scope = spec.aggregation === 'max' ? ' (best session)' : ' (total)'
  return `${spec.filter_value ?? spec.pattern} · ${lowerFirst(activityMeasureLabels[spec.measure])}${scope}`
}

/** A measure's values carry their unit, so only a plain total names it in the header. */
export const totalHeader = (spec: ChallengeSpec): string =>
  spec.aggregation === 'max' ? 'Best' : spec.measure ? 'Total' : `Total (${spec.unit})`

export const formatTotal = (spec: ChallengeSpec, value: number): string =>
  spec.measure ? formatMeasure(spec.measure, value) : Math.round(value).toLocaleString()
