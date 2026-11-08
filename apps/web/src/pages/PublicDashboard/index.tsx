/**
 * PublicResource - resolves `/u/:username/:slug` to a shared dashboard, a
 * challenge or a shared exercise and renders the appropriate view. Rendered without app chrome for
 * anonymous visitors; logged-in viewers keep their nav (see AppShell).
 *
 * - Dashboard, owner viewing their own: live, editable dashboard (own controls),
 *   saved via `updateSharedDashboard`.
 * - Dashboard, anyone else: read-only from server-resolved `widget_data`.
 * - Challenge: the race-chart + leaderboard view.
 * - Exercise: one exercise's records, trend and history, the same for everyone.
 */
import type {
  DashboardConfig,
  PublicSharedDashboardResponse,
  SectionType,
  SharedDashboard,
  WidgetDataMap,
} from '@aurboda/api-spec'

import { periodLabel } from '@aurboda/api-spec'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { AttributionLink } from '../../components/AttributionLink'
import { EditableDashboard } from '../../components/EditableDashboard'
import { PeriodDashboardBar, PeriodSwitcher } from '../../components/PeriodSwitcher'
import { CopyLinkButton, NativeShareButton } from '../../components/ShareControls'
import { ShareDashboardPeriodDialog } from '../../components/ShareDashboardPeriodDialog'
import { usePeriodDashboard } from '../../components/usePeriodDashboard'
import { PublicWidgetRenderer } from '../../components/widgets'
import {
  fetchPublicResource,
  fetchSharedDashboardData,
  listSharedDashboards,
  updateSharedDashboard,
} from '../../state/api'
import { auth } from '../../state/auth'
import { PublicChallenge } from '../Challenges/PublicChallenge'
import { PublicExercise } from '../PublicExercise'
import '../Dashboard/style.css'
import './style.css'

const gridClass = (type: SectionType): string =>
  type === 'links' ? 'links-grid' : type === 'charts' ? 'charts-grid' : 'metrics-grid'

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
      void queryClient.invalidateQueries({ queryKey: ['dashboardData', updated.id] })
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
          <AttributionLink username={username} />
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

      <OwnerSharedDashboardBody
        share={share}
        isEditing={isEditing}
        onChange={(next) => saveMutation.mutate({ config: next, id: share.id })}
      />
    </div>
  )
}

function OwnerSharedDashboardBody({
  share,
  isEditing,
  onChange,
}: {
  share: SharedDashboard
  isEditing: boolean
  onChange: (next: DashboardConfig) => void
}) {
  const period = usePeriodDashboard(share.id, share.config, (key) => fetchSharedDashboardData(share.id, key))
  const [sharingPeriod, setSharingPeriod] = useState<string | null>(null)
  return (
    <>
      {period && <PeriodDashboardBar state={period} onShare={setSharingPeriod} />}
      {sharingPeriod !== null && (
        <ShareDashboardPeriodDialog
          dashboardId={share.id}
          name={share.name}
          period={sharingPeriod}
          publishedUrl={share.visibility === 'private' ? undefined : share.share_url}
          onClose={() => setSharingPeriod(null)}
        />
      )}
      <EditableDashboard
        config={share.config}
        isEditing={isEditing}
        boardId={share.id}
        onChange={onChange}
        widgetData={period?.widgetData}
        periodLabel={period?.periodLabel}
      />
    </>
  )
}

/** A browsable period dashboard's steps: from `earliest` up to the latest finished period. */
interface PeriodBrowsing {
  earliest: string | undefined
  latest: string
  isError: boolean
  select: (key: string) => void
}

function ReadOnlyDashboard({
  username,
  name,
  config,
  widgetData,
  period,
  browsing,
}: {
  username: string
  name: string
  config: DashboardConfig
  widgetData: WidgetDataMap | undefined
  period: string | null | undefined
  browsing: PeriodBrowsing | null
}) {
  const shownPeriod = period ? periodLabel(period) : undefined
  return (
    <div class="dashboard public-dashboard">
      <div class="dashboard-header">
        <h1>{name}</h1>
        <div class="dashboard-actions">
          <AttributionLink username={username} />
          <CopyLinkButton url={window.location.href} />
          <NativeShareButton url={window.location.href} title={`${name} — Aurboda`} />
        </div>
      </div>

      {period && browsing ? (
        <PeriodSwitcher
          value={period}
          latest={browsing.latest}
          earliest={browsing.earliest}
          onChange={browsing.select}
        />
      ) : shownPeriod ? (
        <p class="dashboard-period-label">{shownPeriod}</p>
      ) : null}
      {browsing?.isError ? <div class="error">Could not load this period.</div> : null}

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
                <PublicWidgetRenderer
                  key={widget.id}
                  widget={widget}
                  data={widgetData?.[widget.id]}
                  periodLabel={shownPeriod}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/**
 * A dashboard as a visitor sees it: the period the server answered without `period`, and on a browsable
 * period dashboard any other finished period from `period_from` up to that one.
 */
function VisitorDashboard({
  username,
  slug,
  data,
  config,
}: {
  username: string
  slug: string
  data: PublicSharedDashboardResponse
  config: DashboardConfig
}) {
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
  const latest = data.period_lock === 'browsable' ? data.period : null

  const periodQuery = useQuery({
    enabled: Boolean(latest) && selectedPeriod !== null,
    placeholderData: keepPreviousData,
    queryFn: () => fetchPublicResource(username, slug, selectedPeriod ?? undefined),
    queryKey: ['publicResource', username, slug, selectedPeriod],
    retry: false,
    staleTime: 60 * 1000,
  })

  const browsing: PeriodBrowsing | null = latest
    ? {
        earliest: data.period_from,
        isError: periodQuery.isError,
        latest,
        select: (key) => setSelectedPeriod(key === latest ? null : key),
      }
    : null
  const answered = periodQuery.data
  const shown = browsing && selectedPeriod !== null && answered && 'config' in answered ? answered : data

  return (
    <ReadOnlyDashboard
      username={username}
      name={data.name ?? 'Dashboard'}
      config={config}
      widgetData={shown.widget_data}
      period={shown.period}
      browsing={browsing}
    />
  )
}

/**
 * A challenge, or an exercise (whose owner edits it on the private exercise page), renders the same for
 * everyone from the public fetch.
 */
const sameForEveryoneView = (
  data: Awaited<ReturnType<typeof fetchPublicResource>>,
  username: string,
  slug: string,
  isOwner: boolean,
) => {
  if (data.type === 'challenge' && data.challenge) {
    return <PublicChallenge username={username} slug={slug} challenge={data.challenge} />
  }
  if (data.type === 'exercise' && data.data) {
    return <PublicExercise username={username} resource={data} data={data.data} isOwner={isOwner} />
  }
  return null
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
  const sameForEveryone = data?.success ? sameForEveryoneView(data, username, slug, isOwner) : null
  if (sameForEveryone) return sameForEveryone

  // Owner of this profile → their live, editable dashboard, independent of the
  // (unauthenticated, retry:false) public fetch — so a transient failure of that
  // fetch doesn't strip the owner of their editable view.
  if (isOwner) return <OwnerSharedDashboard username={username} slug={slug} />

  if (query.isError || !data?.success) return <NotFound />

  // Non-owner dashboard. `'config' in data` narrows the union (no cast).
  if ('config' in data && data.config) {
    return <VisitorDashboard username={username} slug={slug} data={data} config={data.config} />
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
