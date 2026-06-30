/**
 * PublicDashboard - a shared dashboard at /u/:username/:slug.
 *
 * - When the logged-in user is the owner (their token is present and the
 *   profile username matches), it renders the live, editable dashboard (same
 *   controls as the home dashboard) and saves edits via `updateSharedDashboard`.
 * - Otherwise it renders read-only from the server-resolved `widget_data` via
 *   `PublicWidgetRenderer` (no per-widget fetching).
 *
 * Rendered without app chrome (see index.tsx).
 */
import type { DashboardConfig, SectionType } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
import { useRoute } from 'preact-iso'

import { EditableDashboard } from '../../components/EditableDashboard'
import { PublicWidgetRenderer } from '../../components/widgets'
import {
  fetchPublicSharedDashboard,
  listSharedDashboards,
  updateSharedDashboard,
} from '../../state/api'
import { auth } from '../../state/auth'
import '../Dashboard/style.css'
import './style.css'

const gridClass = (type: SectionType): string =>
  type === 'links' ? 'links-grid' : type === 'charts' ? 'charts-grid' : 'metrics-grid'

/** Owner view: live, editable dashboard backed by the authed shared-dashboard API. */
function OwnerSharedDashboard({ username, slug }: { username: string; slug: string }) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)

  const listQuery = useQuery({
    queryFn: listSharedDashboards,
    queryKey: ['sharedDashboards'],
    staleTime: 60 * 1000,
  })

  const saveMutation = useMutation({
    mutationFn: ({ id, config }: { id: string; config: DashboardConfig }) =>
      updateSharedDashboard(id, { config }),
    onError: () => alert('Failed to save the dashboard. Please try again.'),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ['sharedDashboards'],
        (old: typeof listQuery.data) => old?.map((d) => (d.id === updated.id ? updated : d)),
      )
    },
  })

  if (listQuery.isLoading) {
    return (
      <div class="public-dashboard">
        <div class="public-loading">Loading…</div>
      </div>
    )
  }

  const share = listQuery.data?.find((d) => d.slug === slug)
  // Owner is logged in but this slug isn't one of theirs — show the public view.
  if (!share) return <ReadOnlyPublicDashboard username={username} slug={slug} />

  return (
    <div class="dashboard public-dashboard">
      <div class="dashboard-header">
        <h1>{share.name}</h1>
        <div class="dashboard-actions">
          <a class="public-attribution" href={`/u/${encodeURIComponent(username)}`}>
            @{username}
          </a>
          {isEditing ? (
            <button class="btn-primary" onClick={() => setIsEditing(false)}>
              Done Editing
            </button>
          ) : (
            <button class="btn-edit" onClick={() => setIsEditing(true)} title="Edit dashboard">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <EditableDashboard
        config={share.config}
        isEditing={isEditing}
        onChange={(next) => saveMutation.mutate({ config: next, id: share.id })}
      />
    </div>
  )
}

/** Read-only view rendered from the server-resolved widget data. */
function ReadOnlyPublicDashboard({ username, slug }: { username: string; slug: string }) {
  const query = useQuery({
    queryFn: () => fetchPublicSharedDashboard(username, slug),
    queryKey: ['publicSharedDashboard', username, slug],
    retry: false,
    staleTime: 60 * 1000,
  })

  if (query.isLoading) {
    return (
      <div class="public-dashboard">
        <div class="public-loading">Loading…</div>
      </div>
    )
  }

  if (query.isError || !query.data?.success || !query.data.config) {
    return (
      <div class="public-dashboard">
        <h1>Dashboard not found</h1>
        <p class="public-muted">This shared dashboard does not exist or is no longer available.</p>
      </div>
    )
  }

  const { config, name, widget_data } = query.data

  return (
    <div class="dashboard public-dashboard">
      <div class="dashboard-header">
        <h1>{name}</h1>
        <a class="public-attribution" href={`/u/${encodeURIComponent(username)}`}>
          @{username}
        </a>
      </div>

      <div class="sections-grid">
        {config.sections.map((section) => (
          <section key={section.id} class="metrics-section">
            <div class="section-header">
              <h2>{section.title}</h2>
            </div>
            <div class={gridClass(section.type)}>
              {section.widgets.map((widget) => (
                <PublicWidgetRenderer key={widget.id} widget={widget} data={widget_data?.[widget.id]} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export function PublicDashboard() {
  const { params } = useRoute()
  const username = params.username
  const slug = params.slug

  const isOwner = Boolean(auth.value.token) && auth.value.user === username

  return isOwner ? (
    <OwnerSharedDashboard username={username} slug={slug} />
  ) : (
    <ReadOnlyPublicDashboard username={username} slug={slug} />
  )
}
