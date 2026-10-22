import type { DataFieldDefinition } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { SessionsTable } from '../../components/sessions/SessionsTable'
import { fieldLabel, groupDurationLabel, isSameSession } from '../../components/sessions/sessionView'
import { fetchActivitySessions } from '../../state/api'

/** Every time this activity type was done with the same value of `field`, this one highlighted. */
const SameValueTable = ({
  activityType,
  field,
  value,
  start,
}: {
  activityType: string
  field: DataFieldDefinition
  value: string
  start: Date
}) => {
  const { data } = useQuery({
    queryFn: () =>
      fetchActivitySessions(activityType, {
        filter_field: field.name,
        filter_value: value,
        group_by: field.name,
      }),
    queryKey: ['activity-sessions', activityType, field.name, 'value', value],
    staleTime: 5 * 60 * 1000,
  })
  const group = data?.groups?.[0]
  if (!data || !group || data.sessions.length < 2) return null

  const duration = groupDurationLabel(group)
  const summary = [
    `${group.count} times`,
    duration && `length ${duration}`,
    group.avg_hr_median !== undefined && `median avg HR ${Math.round(group.avg_hr_median)}`,
    group.max_hr !== undefined && `max HR ${Math.round(group.max_hr)}`,
  ].filter(Boolean)

  return (
    <section class="detail-section same-value-sessions">
      <h3>
        {fieldLabel(field)}: {value}
      </h3>
      <p class="same-value-summary">{summary.join(' · ')}</p>
      <SessionsTable
        sessions={data.sessions}
        fields={[field]}
        showLabel={false}
        isCurrent={(s) => isSameSession(s, start)}
      />
    </section>
  )
}

export const SameValueSessions = ({
  activityType,
  values,
  start,
}: {
  activityType: string
  values: { field: DataFieldDefinition; value: string }[]
  start: Date
}) => (
  <>
    {values.map(({ field, value }) => (
      <SameValueTable
        key={field.name}
        activityType={activityType}
        field={field}
        value={value}
        start={start}
      />
    ))}
  </>
)
