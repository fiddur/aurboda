import type { ComponentChildren } from 'preact'

import { type ActivityMeasure, activityMeasureLabels } from '@aurboda/api-spec'
import { format } from 'date-fns'

import { formatMeasure, formatSet } from '../utils/measures'

const SET_MEASURES = new Set<ActivityMeasure>(['e1rm', 'max_weight'])

export const formatDay = (iso: string): string => format(new Date(iso), 'd MMM yyyy')

/** A record and when it was reached; without a `session_id` (a public page) the date is not a link. */
export interface RecordCardData {
  measure: ActivityMeasure
  value: number
  start_time: string
  session_id?: string
  set?: Record<string, unknown>
}

/** When the record was reached and, for a weight, the set that reached it. */
export const RecordDetail = ({ record }: { record: RecordCardData }) => (
  <>
    {record.session_id === undefined ? (
      formatDay(record.start_time)
    ) : (
      <a href={`/detail/activity/${record.session_id}`}>{formatDay(record.start_time)}</a>
    )}
    {SET_MEASURES.has(record.measure) && record.set && <> · {formatSet(record.set)}</>}
  </>
)

export const RecordCard = ({ record, menu }: { record: RecordCardData; menu?: ComponentChildren }) => (
  <div class={menu ? 'activity-type-item-card has-menu' : 'activity-type-item-card'}>
    {menu && <div class="activity-type-item-card-menu">{menu}</div>}
    <div class="activity-type-item-card-label">{activityMeasureLabels[record.measure]}</div>
    <div class="activity-type-item-card-value">{formatMeasure(record.measure, record.value)}</div>
    <div class="activity-type-item-card-detail">
      <RecordDetail record={record} />
    </div>
  </div>
)
