import {
  type ActivityMeasure,
  type ActivitySessionGroup,
  type DataItemFieldDefinition,
  STRENGTH_SCORE_WINDOW_DAYS,
} from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { fieldLabel, itemPageHref, type ListFieldDefinition } from '../../components/sessions/sessionView'
import { deleteItemValueAliasApi, fetchActivitySessions, fetchItemValueAliases } from '../../state/api'
import { formatBestSet, formatMeasure } from '../../utils/measures'
import {
  filterItemGroups,
  groupPoints,
  type ItemGroupSortKey,
  type PointsByValue,
  sortItemGroups,
} from './itemGroups'
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
  { label: 'Points', value: 'points' },
  { label: 'Name', value: 'name' },
]

/** Strength-only columns: the set behind the best e1RM, and the strength score's points linked to `pointsHref`. */
export interface StrengthColumns {
  points: PointsByValue
  pointsHref: string
}

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

const PointsCell = ({ points, href }: { points: number | undefined; href: string }) => (
  <td class="session-num">{points === undefined ? '–' : <a href={href}>{points}</a>}</td>
)

const ItemGroupsTable = ({
  groups,
  name,
  path,
  item,
  strength,
}: {
  groups: ActivitySessionGroup[]
  name: string
  path: string
  item: DataItemFieldDefinition
  strength?: StrengthColumns
}) => {
  const [sortKey, setSortKey] = useState<ItemGroupSortKey>('recent')
  const [filter, setFilter] = useState('')
  const shown = sortItemGroups(filterItemGroups(groups, filter), sortKey, strength?.points)
  const sortOptions = strength ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.value !== 'points')

  return (
    <>
      <div class="sessions-controls">
        <input
          type="search"
          class="item-groups-filter"
          aria-label={`Filter by ${fieldLabel(item).toLowerCase()}`}
          placeholder="Search"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
        <label class="sessions-control">
          Sort
          <select
            value={sortKey}
            onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as ItemGroupSortKey)}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
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
              {strength && (
                <th scope="col" class="session-num" title="The working set the best e1RM comes from">
                  Best set
                </th>
              )}
              {strength && (
                <th
                  scope="col"
                  class="session-num"
                  title={`Strength score points of the last ${STRENGTH_SCORE_WINDOW_DAYS} days, whatever the period`}
                >
                  Points
                </th>
              )}
              <th scope="col" class="session-num session-opt">
                Max weight
              </th>
              <th
                scope="col"
                class={strength ? 'session-num session-opt' : 'session-num'}
                title="Weight × reps over the period"
              >
                Volume
              </th>
              <th scope="col" class="session-num session-opt" title="Working sets over the period">
                Sets
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={strength ? 9 : 7} class="session-muted">
                  No match.
                </td>
              </tr>
            )}
            {shown.map((g) => (
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
                {strength && <td class="session-num">{g.best_set ? formatBestSet(g.best_set) : '–'}</td>}
                {strength && (
                  <PointsCell points={groupPoints(g, strength.points)} href={strength.pointsHref} />
                )}
                <MeasureCell group={g} measure="max_weight" optional />
                <MeasureCell group={g} measure="volume" optional={strength !== undefined} />
                <MeasureCell group={g} measure="set_count" optional />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const ItemValueAliases = ({ name, path }: { name: string; path: string }) => {
  const queryClient = useQueryClient()
  const queryKey = ['item-value-aliases', name, path]
  const query = useQuery({
    queryFn: () => fetchItemValueAliases(name, path),
    queryKey,
    staleTime: 5 * 60 * 1000,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteItemValueAliasApi(name, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })
  const aliases = query.data ?? []
  if (aliases.length === 0) return null

  return (
    <div class="activity-type-meta-aliases">
      <h3>Aliases</h3>
      <ul class="activity-type-meta-alias-list">
        {aliases.map((a) => (
          <li key={a.id}>
            <span>
              {a.alias} → <a href={itemPageHref(name, path, a.value)}>{a.value}</a>
            </span>
            <button
              type="button"
              class="btn-secondary activity-type-meta-alias-delete"
              disabled={remove.isPending && remove.variables === a.id}
              onClick={() => remove.mutate(a.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {remove.error && <p class="error">Failed to delete the alias.</p>}
      <p class="session-muted activity-type-meta-alias-note">
        Deleting an alias keeps the merged sessions; new imports of that name are stored as written.
      </p>
    </div>
  )
}

/** The type's sessions broken down by an item field of a list, e.g. strength training by exercise. */
export function ItemGroupsSection({
  name,
  path,
  list,
  item,
  heading = `By ${fieldLabel(item).toLowerCase()}`,
  strength,
}: {
  name: string
  path: string
  list: ListFieldDefinition
  item: DataItemFieldDefinition
  heading?: string
  strength?: StrengthColumns
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
        <h2>{heading}</h2>
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
          <p class="activity-type-meta-empty">
            No sessions with {fieldLabel(list).toLowerCase()} in this period.
          </p>
        ) : (
          <ItemGroupsTable groups={groups} name={name} path={path} item={item} strength={strength} />
        ))}
      <ItemValueAliases name={name} path={path} />
    </section>
  )
}
