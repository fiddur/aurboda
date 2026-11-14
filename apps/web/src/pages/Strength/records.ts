import type { ActivityMeasure, ActivityMeasures } from '@aurboda/api-spec'

import type { SetRow } from './sessionModel'

import { formatMeasure, measureSet, recordBadge } from '../../utils/measures'

export interface RecordLines {
  bySet: Map<SetRow, string[]>
  session: string[]
}

/**
 * Where to show the records this session set for one exercise: under the set a single-set measure
 * came from, else for the exercise as a whole. `sets` are all of the exercise's sets in the session.
 */
export const recordLines = (
  records: ActivityMeasure[],
  measures: ActivityMeasures,
  sets: SetRow[],
): RecordLines => {
  const bySet = new Map<SetRow, string[]>()
  const session: string[] = []
  for (const measure of records) {
    const value = measures[measure]
    const line =
      value === undefined ? recordBadge(measure) : `${recordBadge(measure)} ${formatMeasure(measure, value)}`
    const set = measureSet(sets, measure)
    if (set) bySet.set(set, [...(bySet.get(set) ?? []), line])
    else session.push(line)
  }
  return { bySet, session }
}
