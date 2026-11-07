import type { AdminUserOverview } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useMemo, useState } from 'preact/hooks'

import { fetchAdminUsers } from '../../state/api'
import { auth } from '../../state/auth'
import { AdminAccessDenied } from './AccessDenied'
import {
  DEFAULT_SORT,
  formatBytes,
  formatPerDay,
  formatRelative,
  nextSort,
  planLabel,
  type SortKey,
  type SortState,
  sortUsers,
} from './admin-users-utils'
import './style.css'

function SortHeader({
  children,
  column,
  sort,
  onSort,
}: {
  children: ComponentChildren
  column: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
}) {
  const active = sort.key === column
  return (
    <th aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : undefined}>
      <button type="button" class="au-sort" onClick={() => onSort(column)}>
        {children}
        {active && <span class="au-sort-arrow">{sort.descending ? '▼' : '▲'}</span>}
      </button>
    </th>
  )
}

function UserRow({ user, now }: { user: AdminUserOverview; now: Date }) {
  const { route } = useLocation()
  const href = `/admin/users/${encodeURIComponent(user.username)}`
  const apiReads = user.use.mcp.reads_30d + user.use.api.reads_30d
  const plan = planLabel(user, (iso) => (iso ? new Date(iso).toLocaleDateString() : ''))
  return (
    <tr class="au-row" onClick={() => route(href)}>
      <td>
        <a href={href} class="au-name" onClick={(e) => e.stopPropagation()}>
          {user.username}
        </a>
        {user.is_admin && <span class="au-badge">admin</span>}
        {user.email && <div class="au-sub">{user.email}</div>}
      </td>
      <td>
        {user.created_at ? (
          new Date(user.created_at).toLocaleDateString()
        ) : (
          <span class="au-muted">before tracking</span>
        )}
      </td>
      <td>
        <span class={`au-plan au-plan-${plan.tone}`}>{plan.text}</span>
      </td>
      <td class="au-num">{formatBytes(user.storage_bytes)}</td>
      <td>
        <div class="au-num-inline">
          {formatPerDay(user.ingest.per_day_7d)} / {formatPerDay(user.ingest.per_day_30d)}
        </div>
        <div class="au-sub">{formatRelative(user.ingest.last_at, now)}</div>
        {user.ingest.sources.length > 0 && <div class="au-sub">{user.ingest.sources.join(', ')}</div>}
      </td>
      <td>
        <div>{formatRelative(user.last_ui_at, now)}</div>
        <div class="au-sub">{user.use.web.active_days_30d} of 30 days</div>
      </td>
      <td>
        <div>{formatRelative(user.last_api_at, now)}</div>
        <div class="au-sub">{apiReads} reads</div>
      </td>
    </tr>
  )
}

export function AdminUsers() {
  const isAllowed = !!auth.value.token && !!auth.value.is_admin
  const {
    data: users,
    error,
    isLoading,
  } = useQuery({
    enabled: isAllowed,
    queryFn: fetchAdminUsers,
    queryKey: ['adminUsers'],
  })
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const sorted = useMemo(() => sortUsers(users ?? [], sort), [users, sort])
  const now = new Date()

  if (!isAllowed) return <AdminAccessDenied title="Users" />

  const onSort = (key: SortKey) => setSort((current) => nextSort(current, key))

  return (
    <div class="admin-users-page">
      <p class="au-back">
        <a href="/admin">← Admin Settings</a>
      </p>
      <h1>Users</h1>
      {isLoading && <p class="au-muted">Loading...</p>}
      {error && <p class="au-error">Failed to load users: {error.message}</p>}
      {users && (
        <>
          <p class="au-muted">
            {users.length} user{users.length === 1 ? '' : 's'}. Data in is ingest events per day over the last
            7 / 30 days; reads count the last 30 days.
          </p>
          <div class="au-table-scroll">
            <table class="au-table">
              <thead>
                <tr>
                  <SortHeader column="username" sort={sort} onSort={onSort}>
                    User
                  </SortHeader>
                  <SortHeader column="created_at" sort={sort} onSort={onSort}>
                    Signed up
                  </SortHeader>
                  <SortHeader column="plan" sort={sort} onSort={onSort}>
                    Plan
                  </SortHeader>
                  <SortHeader column="storage" sort={sort} onSort={onSort}>
                    Storage
                  </SortHeader>
                  <SortHeader column="ingest" sort={sort} onSort={onSort}>
                    Data in
                  </SortHeader>
                  <SortHeader column="last_ui" sort={sort} onSort={onSort}>
                    Last UI use
                  </SortHeader>
                  <SortHeader column="last_api" sort={sort} onSort={onSort}>
                    Last MCP/API use
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {sorted.map((user) => (
                  <UserRow key={user.username} user={user} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
