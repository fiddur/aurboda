import type {
  ActivitySession,
  ActivitySessionGroup,
  ActivitySessions,
  DataFieldDefinition,
} from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { HrAxisLabel, HrBoxPlot } from '../../components/sessions/HrBoxPlot'
import { HrZoneStrip } from '../../components/sessions/HrZoneStrip'
import { SessionsTable } from '../../components/sessions/SessionsTable'
import {
  fieldLabel,
  groupDurationLabel,
  groupHardMinutes,
  type GroupSortKey,
  hrDomain,
  sortGroups,
} from '../../components/sessions/sessionView'
import { fetchActivitySessions } from '../../state/api'

const LOOKBACK_OPTIONS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 0 },
]

const GROUP_SORT_OPTIONS: { label: string; value: GroupSortKey }[] = [
  { label: 'Recently done', value: 'recent' },
  { label: 'Most done', value: 'count' },
  { label: 'Longest', value: 'duration' },
  { label: 'Highest avg HR', value: 'avg_hr' },
  { label: 'Most Z3+ time', value: 'hard_minutes' },
  { label: 'Name', value: 'name' },
]

const LIST_VIEW = ''

const GroupRow = ({
  group,
  field,
  domain,
  sessions,
}: {
  group: ActivitySessionGroup
  field: DataFieldDefinition
  domain: [number, number] | null
  sessions: ActivitySession[]
}) => {
  const [open, setOpen] = useState(false)
  const hard = groupHardMinutes(group)
  const label = group.value === null ? `No ${fieldLabel(field).toLowerCase()}` : String(group.value)

  return (
    <>
      <tr class={group.value === null ? 'session-group session-group-none' : 'session-group'}>
        <td class="session-label">
          <button type="button" class="session-expand" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {label}
          </button>
        </td>
        <td class="session-num">{group.count}×</td>
        <td class="session-date">{format(new Date(group.last_start_time), 'yyyy-MM-dd')}</td>
        <td class="session-num">{groupDurationLabel(group) ?? '–'}</td>
        <td class="session-num">
          {group.avg_hr_median === undefined ? '–' : Math.round(group.avg_hr_median)}
        </td>
        <td class="session-num">{group.max_hr === undefined ? '–' : Math.round(group.max_hr)}</td>
        <td class="session-num">{hard ?? '–'}</td>
        <td>
          <HrBoxPlot dist={group.hr} domain={domain} />
        </td>
        <td>
          <HrZoneStrip zones={group.hr_zone_secs} />
        </td>
      </tr>
      {open && (
        <tr class="session-group-detail">
          <td colSpan={9}>
            <SessionsTable sessions={sessions} fields={[field]} showLabel={false} />
          </td>
        </tr>
      )}
    </>
  )
}

const GroupsTable = ({
  groups,
  field,
  sessionsById,
}: {
  groups: ActivitySessionGroup[]
  field: DataFieldDefinition
  sessionsById: Map<string, ActivitySession>
}) => {
  const [sortKey, setSortKey] = useState<GroupSortKey>('recent')
  const domain = hrDomain(groups.map((g) => g.hr))

  return (
    <>
      <label class="sessions-control">
        Sort
        <select
          value={sortKey}
          onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as GroupSortKey)}
        >
          {GROUP_SORT_OPTIONS.map((o) => (
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
              <th scope="col">{fieldLabel(field)}</th>
              <th scope="col">Done</th>
              <th scope="col">Last</th>
              <th scope="col">Length</th>
              <th scope="col" title="Median of the sessions' average heart rate">
                Avg
              </th>
              <th scope="col" title="Highest heart rate in any session">
                Max
              </th>
              <th scope="col" title="Minutes in HR zone 3 or higher, per session">
                Z3+
              </th>
              <th scope="col" title="Heart rate over all the sessions">
                <HrAxisLabel domain={domain} />
              </th>
              <th scope="col">Zones</th>
            </tr>
          </thead>
          <tbody>
            {sortGroups(groups, sortKey).map((g) => (
              <GroupRow
                key={JSON.stringify(g.value)}
                group={g}
                field={field}
                domain={domain}
                sessions={g.session_ids.flatMap((id) => sessionsById.get(id) ?? [])}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const SessionsBody = ({
  data,
  fields,
  groupField,
}: {
  data: ActivitySessions
  fields: DataFieldDefinition[]
  groupField?: DataFieldDefinition
}) => {
  if (data.sessions.length === 0) return <p class="activity-type-meta-empty">No sessions in this period</p>
  if (groupField && data.groups) {
    const sessionsById = new Map(data.sessions.map((s) => [s.id, s]))
    return <GroupsTable groups={data.groups} field={groupField} sessionsById={sessionsById} />
  }
  return <SessionsTable sessions={data.sessions} fields={fields} />
}

const SessionsControls = ({
  fields,
  view,
  onView,
  lookback,
  onLookback,
}: {
  fields: DataFieldDefinition[]
  view: string
  onView: (view: string) => void
  lookback: number
  onLookback: (days: number) => void
}) => (
  <div class="sessions-controls">
    {fields.length > 0 && (
      <label class="sessions-control">
        View
        <select value={view} onChange={(e) => onView((e.target as HTMLSelectElement).value)}>
          {fields.map((f) => (
            <option key={f.name} value={f.name}>
              By {fieldLabel(f).toLowerCase()}
            </option>
          ))}
          <option value={LIST_VIEW}>All sessions</option>
        </select>
      </label>
    )}
    <select
      aria-label="Period"
      value={lookback}
      onChange={(e) => onLookback(Number((e.target as HTMLSelectElement).value))}
    >
      {LOOKBACK_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
)

/**
 * The type's sessions with their length and heart rate: grouped by a categorical data field (a
 * catalog to pick the next session from), or as one list.
 */
export function SessionsSection({ name, fields }: { name: string; fields: DataFieldDefinition[] }) {
  const [view, setView] = useState<string | undefined>(undefined)
  const [lookback, setLookback] = useState(365)
  const groupByName = view ?? fields[0]?.name ?? LIST_VIEW
  const groupField = fields.find((f) => f.name === groupByName)

  const query = useQuery({
    queryFn: () =>
      fetchActivitySessions(name, {
        group_by: groupField?.name,
        start: lookback > 0 ? new Date(Date.now() - lookback * 86_400_000).toISOString() : undefined,
      }),
    queryKey: ['activity-sessions', name, groupField?.name, lookback],
    staleTime: 5 * 60 * 1000,
  })

  return (
    <section class="activity-type-meta-section">
      <div class="activity-type-meta-section-header sessions-header">
        <h2>Sessions</h2>
        <SessionsControls
          fields={fields}
          view={groupByName}
          onView={setView}
          lookback={lookback}
          onLookback={setLookback}
        />
      </div>

      {query.isLoading && <p class="loading">Loading sessions...</p>}
      {query.isError && <p class="error">Failed to load sessions</p>}
      {query.data && <SessionsBody data={query.data} fields={fields} groupField={groupField} />}
      {fields.length === 0 && (
        <p class="sessions-hint">
          Mark a data field as categorical in the data schema below (e.g. a session name or a run kind) to
          group sessions by it.
        </p>
      )}
    </section>
  )
}
