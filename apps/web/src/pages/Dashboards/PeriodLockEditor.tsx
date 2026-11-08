import type { SharedDashboard, UpdateSharedDashboardBody } from '@aurboda/api-spec'

import { periodLabel } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { PeriodSwitcher } from '../../components/PeriodSwitcher'
import { fetchSharedDashboardData, updateSharedDashboard } from '../../state/api'
import {
  canSave,
  initialDraft,
  lockBody,
  PERIOD_LOCK_OPTIONS,
  type PeriodLockDraft,
  withFrom,
  withMode,
} from './periodLock'

function PeriodLockForm({ dashboard, latest }: { dashboard: SharedDashboard; latest: string }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<PeriodLockDraft>(() => initialDraft(dashboard, latest))

  const saveMutation = useMutation({
    mutationFn: (body: UpdateSharedDashboardBody) => updateSharedDashboard(dashboard.id, body),
    onError: () => alert('Failed to save who sees which period. Please try again.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sharedDashboards'] }),
  })

  return (
    <div class="period-lock-editor">
      <label class="period-lock-mode">
        Visitors see
        <select
          value={draft.mode}
          aria-label="Period visitors see"
          onChange={(e) => {
            const next = PERIOD_LOCK_OPTIONS.find((o) => o.value === (e.target as HTMLSelectElement).value)
            if (next) setDraft(withMode(draft, next.value))
          }}
        >
          {PERIOD_LOCK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {draft.mode === 'latest' && (
        <span class="period-lock-hint">{periodLabel(latest)} now, moving on as each period ends</span>
      )}
      {draft.mode === 'fixed' && (
        <PeriodSwitcher
          value={draft.fixed}
          latest={latest}
          onChange={(fixed) => setDraft({ ...draft, fixed })}
        />
      )}
      {draft.mode === 'browsable' && (
        <>
          <span class="period-lock-hint">Earliest</span>
          <PeriodSwitcher
            value={draft.from}
            latest={latest}
            onChange={(from) => setDraft(withFrom(draft, from))}
          />
          <label class="period-lock-confirm">
            <input
              type="checkbox"
              checked={draft.confirmed}
              onChange={(e) => setDraft({ ...draft, confirmed: (e.target as HTMLInputElement).checked })}
            />
            Visitors can see every finished period from {periodLabel(draft.from)} on
          </label>
        </>
      )}
      <button
        class="btn-secondary"
        disabled={!canSave(draft, dashboard) || saveMutation.isPending}
        onClick={() => saveMutation.mutate(lockBody(draft))}
      >
        Save
      </button>
    </div>
  )
}

/** What visitors of a published period dashboard may see: the latest period, a fixed one, or browse. */
export function PeriodLockEditor({ dashboard }: { dashboard: SharedDashboard }) {
  const granularity = dashboard.config.period?.granularity ?? null
  const latestQuery = useQuery({
    enabled: granularity !== null,
    queryFn: () => fetchSharedDashboardData(dashboard.id),
    queryKey: ['dashboardData', dashboard.id, granularity, null],
    staleTime: 5 * 60 * 1000,
  })
  const latest = latestQuery.data?.period ?? null

  if (latest === null) {
    return latestQuery.isError ? (
      <div class="period-lock-editor error">Could not load the latest period.</div>
    ) : (
      <div class="period-lock-editor loading">Loading periods…</div>
    )
  }
  return (
    <PeriodLockForm
      key={`${dashboard.period_lock}:${dashboard.period_fixed ?? ''}:${dashboard.period_from ?? ''}:${latest}`}
      dashboard={dashboard}
      latest={latest}
    />
  )
}
