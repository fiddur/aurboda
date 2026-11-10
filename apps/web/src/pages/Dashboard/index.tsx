import type { DashboardConfig } from '@aurboda/api-spec'

import { defaultDashboardConfig } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { EditableDashboard } from '../../components/EditableDashboard'
import { GetStartedGuide } from '../../components/GetStartedGuide'
import { PeriodDashboardBar } from '../../components/PeriodSwitcher'
import { ShareDashboardPeriodDialog } from '../../components/ShareDashboardPeriodDialog'
import { useDashboardDraft } from '../../components/useDashboardDraft'
import { usePeriodDashboard } from '../../components/usePeriodDashboard'
import { fetchDashboard, fetchDashboardData, resetDashboard, saveDashboard } from '../../state/api'
import { auth } from '../../state/auth'
import { readCachedDashboard, writeCachedDashboard } from '../../state/dashboardCache'
import './style.css'

const browserStorage = () => window.localStorage

export function Dashboard() {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [sharingPeriod, setSharingPeriod] = useState<string | null>(null)
  const user = auth.value.user

  const dashboardQuery = useQuery({
    initialData: () => readCachedDashboard(browserStorage, user),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const config = await fetchDashboard()
      writeCachedDashboard(browserStorage, user, config)
      return config
    },
    queryKey: ['dashboard'],
    refetchOnWindowFocus: !isEditing,
    staleTime: 5 * 60 * 1000,
  })

  const draft = useDashboardDraft('home', (_key, config) => saveDashboard(config), {
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      alert('Failed to save the dashboard. Please try again.')
    },
    onSaved: async (_key, data) => {
      await queryClient.cancelQueries({ queryKey: ['dashboard'] })
      writeCachedDashboard(browserStorage, user, data)
      queryClient.setQueryData(['dashboard'], data)
      void queryClient.invalidateQueries({ queryKey: ['dashboardData', 'home'] })
    },
  })

  const resetMutation = useMutation({
    mutationFn: resetDashboard,
    onSuccess: (data) => {
      writeCachedDashboard(browserStorage, user, data)
      queryClient.setQueryData(['dashboard'], data)
      void queryClient.invalidateQueries({ queryKey: ['dashboardData', 'home'] })
    },
  })

  const dashboard: DashboardConfig = draft.config ?? dashboardQuery.data ?? defaultDashboardConfig
  const isLoading = dashboardQuery.isLoading
  const period = usePeriodDashboard('home', dashboard, fetchDashboardData)

  const handleReset = () => {
    if (confirm('Reset dashboard to default configuration? Your customizations will be lost.')) {
      draft.clear()
      resetMutation.mutate()
      setIsEditing(false)
    }
  }

  return (
    <div class="dashboard">
      <div class="dashboard-header">
        <h1>Dashboard</h1>
        <div class="dashboard-actions">
          {isEditing ? (
            <>
              <button class="btn-secondary" onClick={handleReset}>
                Reset to Default
              </button>
              <button class="btn-primary" onClick={() => setIsEditing(false)}>
                Done Editing
              </button>
            </>
          ) : (
            <>
              <a class="dashboard-all-link" href="/dashboards">
                All dashboards
              </a>
              <button class="btn-edit" onClick={() => setIsEditing(true)} title="Edit Dashboard">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {!isEditing && <GetStartedGuide />}

      {!isLoading && period && <PeriodDashboardBar state={period} onShare={setSharingPeriod} />}

      {sharingPeriod !== null && (
        <ShareDashboardPeriodDialog
          name="Home"
          period={sharingPeriod}
          onClose={() => setSharingPeriod(null)}
        />
      )}

      {isLoading && <div class="loading">Loading your dashboard...</div>}

      {!isLoading && (
        <EditableDashboard
          config={dashboard}
          isEditing={isEditing}
          boardId="home"
          onChange={draft.submit}
          widgetData={period?.widgetData}
          widgetDataLoading={period ? period.isFetching || draft.config !== null : undefined}
          periodLabel={period?.periodLabel}
        />
      )}
    </div>
  )
}
