import type { DashboardConfig } from '@aurboda/api-spec'

import { defaultDashboardConfig } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { EditableDashboard } from '../../components/EditableDashboard'
import { fetchDashboard, resetDashboard, saveDashboard } from '../../state/api'
import './style.css'

export function Dashboard() {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)

  const dashboardQuery = useQuery({
    queryFn: fetchDashboard,
    queryKey: ['dashboard'],
    staleTime: 5 * 60 * 1000,
  })

  const saveMutation = useMutation({
    mutationFn: saveDashboard,
    onSuccess: (data) => {
      queryClient.setQueryData(['dashboard'], data)
    },
  })

  const resetMutation = useMutation({
    mutationFn: resetDashboard,
    onSuccess: (data) => {
      queryClient.setQueryData(['dashboard'], data)
    },
  })

  const dashboard: DashboardConfig = dashboardQuery.data ?? defaultDashboardConfig
  const isLoading = dashboardQuery.isLoading

  const handleReset = () => {
    if (confirm('Reset dashboard to default configuration? Your customizations will be lost.')) {
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
            <button class="btn-edit" onClick={() => setIsEditing(true)} title="Edit Dashboard">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {isLoading && <div class="loading">Loading your dashboard...</div>}

      {!isLoading && (
        <EditableDashboard
          config={dashboard}
          isEditing={isEditing}
          onChange={(next) => saveMutation.mutate(next)}
        />
      )}
    </div>
  )
}
