import type { ActivitySession, DataFieldDefinition } from '@aurboda/api-spec'

import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { HrAxisLabel, HrBoxPlot } from './HrBoxPlot'
import { HrZoneStrip } from './HrZoneStrip'
import {
  formatMinutes,
  hardMinutes,
  hrDomain,
  type SessionSortKey,
  sessionLabel,
  sortSessions,
} from './sessionView'
import './sessions.css'

const PAGE = 25

const SortHeader = ({
  label,
  sortKey,
  sort,
  onSort,
  title,
}: {
  label: string
  sortKey: SessionSortKey
  sort: { key: SessionSortKey; desc: boolean }
  onSort: (key: SessionSortKey) => void
  title?: string
}) => (
  <th
    scope="col"
    title={title}
    aria-sort={sort.key === sortKey ? (sort.desc ? 'descending' : 'ascending') : undefined}
  >
    <button type="button" class="session-sort" onClick={() => onSort(sortKey)}>
      {label}
      {sort.key === sortKey ? (sort.desc ? ' ▾' : ' ▴') : ''}
    </button>
  </th>
)

/**
 * Sessions with length, HR and zone mix, sortable by any number column. `isCurrent` marks the
 * session on screen; `showLabel` false drops the name column when every row shares it.
 */
export const SessionsTable = ({
  sessions,
  fields,
  isCurrent,
  showLabel = true,
}: {
  sessions: ActivitySession[]
  fields: DataFieldDefinition[]
  isCurrent?: (session: ActivitySession) => boolean
  showLabel?: boolean
}) => {
  const [sort, setSort] = useState<{ key: SessionSortKey; desc: boolean }>({ desc: true, key: 'date' })
  const [shown, setShown] = useState(PAGE)
  const onSort = (key: SessionSortKey) =>
    setSort((prev) => ({ desc: prev.key === key ? !prev.desc : true, key }))

  const domain = hrDomain(sessions.map((s) => s.hr))
  const sorted = sortSessions(sessions, sort.key, sort.desc)
  const header = { onSort, sort }

  return (
    <div class="sessions-table-wrap">
      <table class="sessions-table">
        <thead>
          <tr>
            <SortHeader label="Date" sortKey="date" {...header} />
            {showLabel && <th scope="col">Session</th>}
            <SortHeader label="Length" sortKey="duration" {...header} />
            <SortHeader label="Avg" sortKey="avg_hr" title="Average heart rate" {...header} />
            <SortHeader label="Max" sortKey="max_hr" title="Maximum heart rate" {...header} />
            <SortHeader
              label="Z3+"
              sortKey="hard_minutes"
              title="Minutes in HR zone 3 or higher"
              {...header}
            />
            <th scope="col">
              <HrAxisLabel domain={domain} />
            </th>
            <th scope="col">Zones</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, shown).map((s) => (
            <tr key={s.id} class={isCurrent?.(s) ? 'session-current' : undefined}>
              <td class="session-date">
                <a href={`/detail/activity/${s.id}`}>{format(new Date(s.start_time), 'yyyy-MM-dd HH:mm')}</a>
              </td>
              {showLabel && (
                <td class="session-label">
                  {sessionLabel(s, fields) ?? <span class="session-muted">–</span>}
                </td>
              )}
              <td class="session-num">{s.duration === undefined ? '–' : formatMinutes(s.duration)}</td>
              <td class="session-num">{s.avg_hr === undefined ? '–' : Math.round(s.avg_hr)}</td>
              <td class="session-num">{s.max_hr === undefined ? '–' : Math.round(s.max_hr)}</td>
              <td class="session-num">{hardMinutes(s.hr_zone_secs) ?? '–'}</td>
              <td>
                <HrBoxPlot dist={s.hr} domain={domain} />
              </td>
              <td>
                <HrZoneStrip zones={s.hr_zone_secs} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > shown && (
        <button type="button" class="session-more" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({sorted.length - shown} left)
        </button>
      )}
    </div>
  )
}
