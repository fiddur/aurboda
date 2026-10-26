import {
  type ActivityItemGroup,
  type ActivityMeasures,
  activityMeasureLabels,
  type DataItemFieldDefinition,
} from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

import { fieldLabel, itemPageHref } from '../../components/sessions/sessionView'
import { fetchActivityItemHistory } from '../../state/api'
import { formatMeasure, formatSets } from '../../utils/measures'

const measureSummary = (measures: ActivityMeasures): string =>
  [
    measures.e1rm !== undefined && `e1RM ${formatMeasure('e1rm', measures.e1rm)}`,
    measures.volume !== undefined && `volume ${formatMeasure('volume', measures.volume)}`,
  ]
    .filter(Boolean)
    .join(' · ')

const Measures = ({ measures }: { measures: ActivityMeasures }) => {
  const text = measureSummary(measures)
  return text ? <span class="item-history-measures"> · {text}</span> : null
}

const ItemGroup = ({
  group,
  activityType,
  path,
}: {
  group: ActivityItemGroup
  activityType: string
  path: string
}) => (
  <li class="item-history-group">
    <div class="item-history-name">
      <a href={itemPageHref(activityType, path, group.value)}>{group.value}</a>
      {group.records.map((m) => (
        <span key={m} class="item-history-pr" title={activityMeasureLabels[m]}>
          PR
        </span>
      ))}
    </div>
    <div class="item-history-line">
      <span class="item-history-when">This time</span> {formatSets(group.items)}
      <Measures measures={group.measures} />
    </div>
    <div class="item-history-line">
      {group.previous ? (
        <>
          <span class="item-history-when">
            Last time{' '}
            <a href={`/detail/activity/${group.previous.id}`}>
              {format(new Date(group.previous.start_time), 'd MMM yyyy')}
            </a>
          </span>{' '}
          {formatSets(group.previous.items)}
          <Measures measures={group.previous.measures} />
        </>
      ) : (
        <span class="item-history-when">First time</span>
      )}
    </div>
  </li>
)

/** The session's items grouped by an item field (its exercises), each compared with the last time. */
export const ItemHistorySection = ({
  activityId,
  activityType,
  path,
  item,
}: {
  activityId: string
  activityType: string
  path: string
  item: DataItemFieldDefinition
}) => {
  const { data } = useQuery({
    queryFn: () => fetchActivityItemHistory(activityId, path),
    queryKey: ['activity-item-history', activityId, path],
    staleTime: 5 * 60 * 1000,
  })
  if (!data || data.groups.length === 0) return null

  const { set_count: sets, volume } = data.totals
  const totals = [
    volume !== undefined && `Volume ${formatMeasure('volume', volume)}`,
    sets !== undefined && `${sets} ${sets === 1 ? 'set' : 'sets'}`,
  ].filter(Boolean)

  return (
    <div class="item-history">
      <h3>
        {`${fieldLabel(item)}s`}
        {totals.length > 0 && <span class="item-history-totals"> {totals.join(' · ')}</span>}
      </h3>
      <ul class="item-history-groups">
        {data.groups.map((g) => (
          <ItemGroup key={g.value} group={g} activityType={activityType} path={path} />
        ))}
      </ul>
    </div>
  )
}
