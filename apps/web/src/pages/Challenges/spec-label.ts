import { activityMeasureUnits, type ChallengeSpec, measureSpecLabel } from '@aurboda/api-spec'

import { formatMeasure } from '../../utils/measures'

/** What a challenge scores, in a line: `Push-ups · most reps in a set (best session)`. */
export const describeSpec = (spec: ChallengeSpec): string => {
  if (!spec.measure) return `${spec.pattern} · ${spec.aggregation}`
  const scope = spec.aggregation === 'max' ? ' (best session)' : ''
  return `${measureSpecLabel(spec.measure, spec.filter_value, spec.pattern)}${scope}`
}

/** A measure's values carry their unit, so only a plain total names it in the header. */
export const totalHeader = (spec: ChallengeSpec): string =>
  spec.aggregation === 'max' ? 'Best' : spec.measure ? 'Total' : `Total (${spec.unit})`

export const formatTotal = (spec: ChallengeSpec, value: number): string => {
  if (!spec.measure) return Math.round(value).toLocaleString()
  const formatted = formatMeasure(spec.measure, value)
  return activityMeasureUnits[spec.measure] || !spec.unit ? formatted : `${formatted} ${spec.unit}`
}
