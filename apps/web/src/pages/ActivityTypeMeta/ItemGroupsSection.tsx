import type { ActivityMeasure, ActivitySessionGroup, DataItemFieldDefinition } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { fieldLabel, itemPageHref } from '../../components/sessions/sessionView'
import { fetchActivitySessions } from '../../state/api'
import { formatMeasure } from '../../utils/measures'
import { type ItemGroupSortKey, sortItemGroups } from './itemGroups'
import '../../components/sessions/sessions.css'

const LOOKBACK_OPTIONS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 0 },
]

const SORT_OPTIONS: { label: string; value: ItemGroupSortKey }[] = [
  { label: 'Recently done', value: 'recent' },
  { label: 'Most done', value: 'count' },
  { label: 'Best e1RM', value: 'e1rm' },
  { label: 'Max weight', value: 'max_weight' },
  { label: 'Volume', value: 'volume' },
  { label: 'Name', value: 'name' },
]

const MeasureCell = ({
  group,
  measure,
  optional,
}: {
  group: ActivitySessionGroup
  measure: ActivityMeasure
  optional?: boolean
}) => {
  const value = group.measures?.[measure]
  return (
    <td class={optional ? 'session-num session-opt' : 'session-num'}>
      {value === undefined ? '–' : formatMeasure(measure, value)}
    </td>
  )
}

const ItemGroupsTable = ({
  groups,
  name,
  path,
  item,
}: {
  groups: ActivitySessionGroup[]
  name: string
  path: string
  item: DataItemFieldDefinition
}) => {
  const [sortKey, setSortKey] = useState<ItemGroupSortKey>('recent')

  return (
    <>
      <label class="sessions-control">
        Sort
        <select
          value={sortKey}
          onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as ItemGroupSortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div class="sessions-table-wrap">
        <table class="sessions-table">
          <thead>
            <tr>
              <th scope="col">{fieldLabel(item)}</th>
              <th scope="col" class="session-num">
                Done
              </th>
              <th scope="col" class="session-opt">
                Last
              </th>
              <th scope="col" class="session-num" title="Best estimated one-rep max (Epley)">
                Best e1RM
              </th>
              <th scope="col" class="session-num session-opt">
                Max weight
              </th>
              <th scope="col" class="session-num" title="Weight × reps over the period">
                Volume
              </th>
              <th scope="col" class="session-num session-opt" title="Working sets over the period">
                Sets
              </th>
            </tr>
          </thead>
          <tbody>
            {sortItemGroups(groups, sortKey).map((g) => (
              <tr key={JSON.stringify(g.value)} class={g.value === null ? 'session-group-none' : undefined}>
                <td class="session-label">
                  {g.value === null ? (
                    <span class="session-muted">No {fieldLabel(item).toLowerCase()}</span>
                  ) : (
                    <a href={itemPageHref(name, path, String(g.value))}>{String(g.value)}</a>
                  )}
                </td>
                <td class="session-num">{g.count}×</td>
                <td class="session-date session-opt">{format(new Date(g.last_start_time), 'yyyy-MM-dd')}</td>
                <MeasureCell group={g} measure="e1rm" />
                <MeasureCell group={g} measure="max_weight" optional />
                <MeasureCell group={g} measure="volume" />
                <MeasureCell group={g} measure="set_count" optional />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** The type's sessions broken down by an item field of a list, e.g. strength training by exercise. */
export function ItemGroupsSection({
  name,
  path,
  item,
}: {
  name: string
  path: string
  item: DataItemFieldDefinition
}) {
  const [lookback, setLookback] = useState(90)

  const query = useQuery({
    queryFn: () =>
      fetchActivitySessions(name, {
        group_by: path,
        start: lookback > 0 ? new Date(Date.now() - lookback * 86_400_000).toISOString() : undefined,
      }),
    queryKey: ['activity-sessions', name, path, 'groups', lookback],
    staleTime: 5 * 60 * 1000,
  })
  const groups = query.data?.groups ?? []

  return (
    <section class="activity-type-meta-section">
      <div class="activity-type-meta-section-header sessions-header">
        <h2>By {fieldLabel(item).toLowerCase()}</h2>
        <select
          aria-label="Period"
          value={lookback}
          onChange={(e) => setLookback(Number((e.target as HTMLSelectElement).value))}
        >
          {LOOKBACK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load sessions</p>}
      {query.data &&
        (groups.length === 0 ? (
          <p class="activity-type-meta-empty">No sessions with sets in this period.</p>
        ) : (
          <ItemGroupsTable groups={groups} name={name} path={path} item={item} />
        ))}
    </section>
  )
}
