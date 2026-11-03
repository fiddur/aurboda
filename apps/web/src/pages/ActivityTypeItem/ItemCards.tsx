import { type ActivityMeasure, activityMeasureLabels } from '@aurboda/api-spec'
import { format } from 'date-fns'

import { formatMeasure, formatSet } from '../../utils/measures'

const SET_MEASURES = new Set<ActivityMeasure>(['e1rm', 'max_weight'])

const day = (iso: string): string => format(new Date(iso), 'd MMM yyyy')

/** A record and when it was reached; without a `session_id` (a public page) the date is not a link. */
export interface RecordCardData {
  measure: ActivityMeasure
  value: number
  start_time: string
  session_id?: string
  set?: Record<string, unknown>
}

export const RecordCard = ({ record }: { record: RecordCardData }) => (
  <div class="activity-type-item-card">
    <div class="activity-type-item-card-label">{activityMeasureLabels[record.measure]}</div>
    <div class="activity-type-item-card-value">{formatMeasure(record.measure, record.value)}</div>
    <div class="activity-type-item-card-detail">
      {record.session_id === undefined ? (
        day(record.start_time)
      ) : (
        <a href={`/detail/activity/${record.session_id}`}>{day(record.start_time)}</a>
      )}
      {SET_MEASURES.has(record.measure) && record.set && <> · {formatSet(record.set)}</>}
    </div>
  </div>
)

export const DoneCard = ({ done }: { done: { count: number; first: string; last: string } }) => (
  <div class="activity-type-item-card">
    <div class="activity-type-item-card-label">Done</div>
    <div class="activity-type-item-card-value">{done.count}×</div>
    <div class="activity-type-item-card-detail">
      {done.count === 1 ? day(done.first) : `${day(done.first)} – ${day(done.last)}`}
    </div>
  </div>
)
