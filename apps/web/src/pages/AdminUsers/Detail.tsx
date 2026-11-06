import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useMemo } from 'preact/hooks'

import { DeleteAccountConfirm } from '../../components/DeleteAccountConfirm'
import { deleteAdminUser, fetchAdminUserUsage } from '../../state/api'
import { auth } from '../../state/auth'
import { AdminAccessDenied } from './AccessDenied'
import { formatBytes, stackDaily } from './admin-users-utils'
import { PlanEditor } from './PlanEditor'
import { StackedDailyChart } from './StackedDailyChart'
import './style.css'

const DAYS = 90

const todayUtc = () => new Date().toISOString().slice(0, 10)

export function AdminUserDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const username = params.username ?? ''
  const isAllowed = !!auth.value.token && !!auth.value.is_admin
  const isSelf = username === auth.value.user
  const {
    data: usage,
    error,
    isLoading,
  } = useQuery({
    enabled: isAllowed && username !== '',
    queryFn: () => fetchAdminUserUsage(username, DAYS),
    queryKey: ['adminUserUsage', username, DAYS],
  })

  const charts = useMemo(() => {
    if (!usage) return null
    const until = todayUtc()
    return {
      ingest: stackDaily(usage.daily, (row) => row.kind === 'ingest', usage.since, until),
      use: stackDaily(usage.daily, (row) => row.kind !== 'ingest', usage.since, until),
    }
  }, [usage])

  if (!isAllowed) return <AdminAccessDenied title={username} />

  return (
    <div class="admin-users-page">
      <p class="au-back">
        <a href="/admin/users">← Users</a>
      </p>
      <h1>
        {username}
        {usage?.is_admin && <span class="au-badge">admin</span>}
      </h1>
      {isLoading && <p class="au-muted">Loading...</p>}
      {error && <p class="au-error">Failed to load usage: {error.message}</p>}
      {usage && charts && (
        <>
          <dl class="au-facts">
            <div>
              <dt>Signed up</dt>
              <dd>
                {usage.created_at ? new Date(usage.created_at).toLocaleDateString() : 'before tracking'}
              </dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{formatBytes(usage.storage_bytes)}</dd>
            </div>
          </dl>

          <PlanEditor key={username} username={username} plan={usage} />

          <section class="au-section">
            <h2>Data in</h2>
            <p class="au-muted">Ingest events per day by source, last {DAYS} days (UTC).</p>
            <StackedDailyChart data={charts.ingest} />
          </section>

          <section class="au-section">
            <h2>Use</h2>
            <p class="au-muted">Reads and writes per day by channel, last {DAYS} days (UTC).</p>
            <StackedDailyChart data={charts.use} />
          </section>

          <section class="au-section">
            <h2>Largest tables</h2>
            {usage.largest_tables.length === 0 ? (
              <p class="au-muted">No tables.</p>
            ) : (
              <table class="au-table au-tables">
                <tbody>
                  {usage.largest_tables.map((t) => (
                    <tr key={t.table}>
                      <td>{t.table}</td>
                      <td class="au-num">{formatBytes(t.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {!isSelf && (
            <section class="au-section">
              <h2>Delete user</h2>
              <p class="au-muted">
                Removes all of {username}'s data, integration connections and public profile for good, tells
                their followers on other servers the account is gone, and reserves the username so it can
                never be signed up again. They can download an export from their Settings first.
              </p>
              <DeleteAccountConfirm
                username={username}
                label="Delete user"
                onDelete={() => deleteAdminUser(username, { confirm_username: username })}
                onDeleted={() => {
                  void queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
                  route('/admin/users')
                }}
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}
