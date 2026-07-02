/**
 * SharedDashboards - manage the current user's published dashboards.
 *
 * Create a shareable copy (seeded from the home dashboard or blank), toggle
 * public/unlisted, copy the share link, rename (auto-saves on blur), delete.
 * Per-widget editing of a shared dashboard is a follow-up; today a share is
 * seeded from the home dashboard's current layout.
 */
import type { DashboardConfig, SharedDashboard } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import {
  createSharedDashboard,
  deleteSharedDashboard,
  fetchDashboard,
  listSharedDashboards,
  updateSharedDashboard,
} from '../../state/api'
import './style.css'

function SharedDashboardRow({ dashboard }: { dashboard: SharedDashboard }) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sharedDashboards'] })

  const updateMutation = useMutation({
    mutationFn: (body: { name?: string; is_public?: boolean }) => updateSharedDashboard(dashboard.id, body),
    onError: () => alert('Failed to update the shared dashboard. Please try again.'),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSharedDashboard(dashboard.id),
    onError: () => alert('Failed to delete the shared dashboard. Please try again.'),
    onSuccess: invalidate,
  })

  const handleRename = (e: Event) => {
    const value = (e.target as HTMLInputElement).value.trim()
    if (value && value !== dashboard.name) updateMutation.mutate({ name: value })
  }

  const handleCopy = async () => {
    // navigator.clipboard is only available in secure contexts; instances may be
    // served over plain http, so guard and fall back to a manual prompt.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(dashboard.share_url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } else {
        window.prompt('Copy this link:', dashboard.share_url)
      }
    } catch {
      window.prompt('Copy this link:', dashboard.share_url)
    }
  }

  const handleDelete = () => {
    if (confirm(`Delete shared dashboard "${dashboard.name}"? Its link will stop working.`)) {
      deleteMutation.mutate()
    }
  }

  return (
    <li class="shared-dashboard-row">
      <input
        class="shared-dashboard-name"
        type="text"
        value={dashboard.name}
        onBlur={handleRename}
        aria-label="Dashboard name"
      />
      <label class="shared-dashboard-public">
        <input
          type="checkbox"
          checked={dashboard.is_public}
          onChange={(e) => updateMutation.mutate({ is_public: (e.target as HTMLInputElement).checked })}
        />
        Public
      </label>
      <div class="shared-dashboard-actions">
        <a class="btn-secondary" href={dashboard.share_url} target="_blank" rel="noopener noreferrer">
          View
        </a>
        <button class="btn-secondary" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button class="btn-danger" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </li>
  )
}

export function SharedDashboards() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const query = useQuery({
    queryFn: listSharedDashboards,
    queryKey: ['sharedDashboards'],
    staleTime: 60 * 1000,
  })

  const createMutation = useMutation({
    mutationFn: async (seedFromHome: boolean) => {
      const emptyConfig: DashboardConfig = { sections: [], version: 1 }
      const config = seedFromHome ? await fetchDashboard() : emptyConfig
      return createSharedDashboard({ config, is_public: false, name: name.trim() || 'Shared dashboard' })
    },
    onError: () => alert('Failed to create the shared dashboard. Please try again.'),
    onSuccess: () => {
      setName('')
      queryClient.invalidateQueries({ queryKey: ['sharedDashboards'] })
    },
  })

  const dashboards = query.data ?? []

  return (
    <div class="shared-dashboards">
      <div class="shared-dashboards-header">
        <h1>Shared dashboards</h1>
      </div>

      <p class="shared-dashboards-intro">
        Publish read-only copies of a dashboard under your public page. Public ones are listed on your
        profile; unlisted ones are reachable only via their link.
      </p>

      <div class="shared-dashboards-create">
        <input
          type="text"
          value={name}
          placeholder="New dashboard name"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button
          class="btn-primary"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate(true)}
        >
          Create from my dashboard
        </button>
        <button
          class="btn-secondary"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate(false)}
        >
          Create blank
        </button>
      </div>

      {query.isLoading && <div class="loading">Loading…</div>}

      {!query.isLoading &&
        (dashboards.length === 0 ? (
          <p class="shared-dashboards-empty">You haven’t shared any dashboards yet.</p>
        ) : (
          <ul class="shared-dashboards-list">
            {dashboards.map((d) => (
              <SharedDashboardRow key={d.id} dashboard={d} />
            ))}
          </ul>
        ))}
    </div>
  )
}
