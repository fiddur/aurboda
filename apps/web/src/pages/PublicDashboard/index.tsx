/**
 * PublicResource - resolves `/u/:username/:slug` to either a shared dashboard or
 * a challenge and renders the appropriate view. Rendered without app chrome for
 * anonymous visitors; logged-in viewers keep their nav (see AppShell).
 *
 * - Dashboard, owner viewing their own: live, editable dashboard (own controls),
 *   saved via `updateSharedDashboard`.
 * - Dashboard, anyone else: read-only from server-resolved `widget_data`.
 * - Challenge: the race-chart + leaderboard view.
 */
import type { DashboardConfig, SectionType, WidgetDataMap } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { EditableDashboard } from '../../components/EditableDashboard'
import { ShareLinkButton } from '../../components/ShareLinkButton'
import { PublicWidgetRenderer } from '../../components/widgets'
import { avatarUrl, fetchPublicResource, listSharedDashboards, updateSharedDashboard } from '../../state/api'
import { auth } from '../../state/auth'
import { PublicChallenge } from '../Challenges/PublicChallenge'
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
      queryClient.setQueryData(['sharedDashboards'], (old: typeof listQuery.data) =>
        old?.map((d) => (d.id === updated.id ? updated : d)),
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
  if (!share) {
    return (
      <div class="public-dashboard">
        <h1>Dashboard not found</h1>
        <p class="public-muted">This shared dashboard does not exist or is no longer available.</p>
      </div>
    )
  }

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
          )}
        </div>
      </div>

      <EditableDashboard
        config={share.config}
        isEditing={isEditing}
        boardId={share.id}
        onChange={(next) => saveMutation.mutate({ config: next, id: share.id })}
      />
    </div>
  )
}

/** Read-only dashboard rendered from already-fetched server data. */
function ReadOnlyDashboard({
  username,
  name,
  config,
  widgetData,
}: {
  username: string
  name: string
  config: DashboardConfig
  widgetData: WidgetDataMap | undefined
}) {
  return (
    <div class="dashboard public-dashboard">
      <div class="dashboard-header">
        <h1>{name}</h1>
        <a class="public-attribution" href={`/u/${encodeURIComponent(username)}`}>
          <img class="public-attribution__avatar" src={avatarUrl(username)} alt="" width={28} height={28} />@
          {username}
        </a>
        <ShareLinkButton url={window.location.href} title={`${name} — Aurboda`} />
      </div>

      {config.description ? <p class="dashboard-intro">{config.description}</p> : null}

      <div class="sections-grid">
        {config.sections.map((section) => (
          <section key={section.id} class="metrics-section">
            <div class="section-header">
              <h2>{section.title}</h2>
            </div>
            {section.description ? <p class="section-intro">{section.description}</p> : null}
            <div class={gridClass(section.type)}>
              {section.widgets.map((widget) => (
                <PublicWidgetRenderer key={widget.id} widget={widget} data={widgetData?.[widget.id]} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export function PublicResource() {
  const { params } = useRoute()
  const username = params.username
  const slug = params.slug
  const isOwner = Boolean(auth.value.token) && auth.value.user === username

  const query = useQuery({
    queryFn: () => fetchPublicResource(username, slug),
    queryKey: ['publicResource', username, slug],
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

  const data = query.data

  // Challenge — same view for everyone (from a successful public fetch).
  if (data?.success && data.type === 'challenge' && data.challenge) {
    return <PublicChallenge username={username} slug={slug} challenge={data.challenge} />
  }

  // Owner of this profile → their live, editable dashboard, independent of the
  // (unauthenticated, retry:false) public fetch — so a transient failure of that
  // fetch doesn't strip the owner of their editable view.
  if (isOwner) return <OwnerSharedDashboard username={username} slug={slug} />

  if (query.isError || !data?.success) return <NotFound />

  // Non-owner dashboard. `'config' in data` narrows the union (no cast).
  if ('config' in data && data.config) {
    return (
      <ReadOnlyDashboard
        username={username}
        name={data.name ?? 'Dashboard'}
        config={data.config}
        widgetData={data.widget_data}
      />
    )
  }
  return <NotFound />
}

function NotFound() {
  return (
    <div class="public-dashboard">
      <h1>Not found</h1>
      <p class="public-muted">This page does not exist or is no longer available.</p>
    </div>
  )
}
