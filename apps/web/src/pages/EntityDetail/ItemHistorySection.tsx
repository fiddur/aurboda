import {
  type ActivityItemGroup,
  type ActivityMeasures,
  activityMeasureLabels,
  type DataItemFieldDefinition,
} from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'preact'

import { fieldLabel, itemPageHref } from '../../components/sessions/sessionView'
import { fetchActivityItemHistory } from '../../state/api'
import { formatMeasure, formatSet, recordBadge, trendParts } from '../../utils/measures'

const Parts = ({ parts, separator = ' · ' }: { parts: string[]; separator?: string }) => (
  <>
    {parts.map((part, i) => (
      <Fragment key={i}>
        {i > 0 && separator}
        <span class="item-history-part">{part}</span>
      </Fragment>
    ))}
  </>
)

const measureParts = (measures: ActivityMeasures): string[] =>
  [
    measures.e1rm !== undefined && `e1RM ${formatMeasure('e1rm', measures.e1rm)}`,
    measures.volume !== undefined && `volume ${formatMeasure('volume', measures.volume)}`,
  ].filter((part) => part !== false)

const Measures = ({ measures }: { measures: ActivityMeasures }) => {
  const parts = measureParts(measures)
  return parts.length > 0 ? (
    <span class="item-history-measures">
      {' · '}
      <Parts parts={parts} />
    </span>
  ) : null
}

const TrendLine = ({ group, halfLifeDays }: { group: ActivityItemGroup; halfLifeDays: number }) => {
  const parts = trendParts(group.trend)
  if (parts) {
    return (
      <div class="item-history-line">
        <span class="item-history-when" title={`Decaying best with a ${halfLifeDays}-day half-life`}>
          Trend
        </span>{' '}
        <Parts parts={parts} />
      </div>
    )
  }
  return group.previous ? null : (
    <div class="item-history-line">
      <span class="item-history-when">First time</span>
    </div>
  )
}

const ItemGroup = ({
  group,
  activityType,
  path,
  halfLifeDays,
}: {
  group: ActivityItemGroup
  activityType: string
  path: string
  halfLifeDays: number
}) => (
  <li class="item-history-group">
    <div class="item-history-name">
      <a href={itemPageHref(activityType, path, group.value)}>{group.value}</a>
      {group.records.map((m) => (
        <span key={m} class="item-history-pr" title={activityMeasureLabels[m]}>
          {recordBadge(m)}
        </span>
      ))}
    </div>
    <div class="item-history-line">
      <span class="item-history-when">This time</span>{' '}
      <Parts parts={group.items.map(formatSet)} separator=", " />
      <Measures measures={group.measures} />
    </div>
    <TrendLine group={group} halfLifeDays={halfLifeDays} />
  </li>
)

/** The session's items grouped by an item field (its exercises), each with its trend before and after the session. */
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
          <ItemGroup
            key={g.value}
            group={g}
            activityType={activityType}
            path={path}
            halfLifeDays={data.trend_half_life_days}
          />
        ))}
      </ul>
    </div>
  )
}
