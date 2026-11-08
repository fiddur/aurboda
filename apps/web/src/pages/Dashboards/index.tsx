/**
 * Dashboards - every dashboard the user has: the home dashboard first, then
 * each further one (private, unlisted or public), each opened and edited at
 * `/u/<me>/<slug>`. Create one from a preset, rename (auto-saves on blur),
 * change who sees it (and, for a published period dashboard, which periods), copy its link, delete. Below them, the exercises shared
 * from their exercise pages.
 */
import type {
  DashboardPreset,
  DashboardVisibility,
  ShareVisibility,
  SharedDashboard,
  SharedExercise,
} from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { itemPageHref } from '../../components/sessions/sessionView'
import { useCopyLink } from '../../components/ShareControls'
import {
  DASHBOARD_VISIBILITY_OPTIONS,
  SHARE_VISIBILITY_OPTIONS,
  VisibilitySelector,
} from '../../components/VisibilitySelector'
import {
  createSharedDashboard,
  deleteSharedDashboard,
  deleteSharedExercise,
  listSharedDashboards,
  listSharedExercises,
  updateSharedDashboard,
  updateSharedExercise,
} from '../../state/api'
import { auth } from '../../state/auth'
import { toDisplayName } from '../../utils/displayName'
import { hasPeriodLock } from './periodLock'
import { PeriodLockEditor } from './PeriodLockEditor'
import { nameAfterPresetChange, PRESET_OPTIONS, presetName } from './presets'
import './style.css'

const dashboardPath = (slug: string) => `/u/${auth.value.user ?? ''}/${slug}`

function HomeDashboardRow() {
  return (
    <li class="shared-dashboard-row">
      <span class="shared-dashboard-name home-dashboard-name">Home</span>
      <span class="home-dashboard-hint">Your start page</span>
      <div class="shared-dashboard-actions">
        <a class="btn-secondary" href="/">
          View
        </a>
      </div>
    </li>
  )
}

function SharedDashboardRow({ dashboard }: { dashboard: SharedDashboard }) {
  const queryClient = useQueryClient()
  const { copied, copy: handleCopy } = useCopyLink(dashboard.share_url)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sharedDashboards'] })

  const updateMutation = useMutation({
    mutationFn: (body: { name?: string; visibility?: DashboardVisibility }) =>
      updateSharedDashboard(dashboard.id, body),
    onError: () => alert('Failed to update the dashboard. Please try again.'),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSharedDashboard(dashboard.id),
    onError: () => alert('Failed to delete the dashboard. Please try again.'),
    onSuccess: invalidate,
  })

  const handleRename = (e: Event) => {
    const value = (e.target as HTMLInputElement).value.trim()
    if (value && value !== dashboard.name) updateMutation.mutate({ name: value })
  }

  const handleDelete = () => {
    if (confirm(`Delete dashboard "${dashboard.name}"? Its link will stop working.`)) {
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
      <VisibilitySelector
        compact
        name={`dashboard-visibility-${dashboard.id}`}
        options={DASHBOARD_VISIBILITY_OPTIONS}
        value={dashboard.visibility}
        onChange={(visibility) => updateMutation.mutate({ visibility })}
      />
      <div class="shared-dashboard-actions">
        <a class="btn-secondary" href={dashboardPath(dashboard.slug)}>
          View
        </a>
        {dashboard.visibility !== 'private' && (
          <button class="btn-secondary" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        )}
        <button class="btn-danger" onClick={handleDelete}>
          Delete
        </button>
      </div>
      {hasPeriodLock(dashboard) && <PeriodLockEditor dashboard={dashboard} />}
    </li>
  )
}

function SharedExerciseRow({ exercise }: { exercise: SharedExercise }) {
  const queryClient = useQueryClient()
  const { copied, copy } = useCopyLink(exercise.share_url)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sharedExercises'] })

  const updateMutation = useMutation({
    mutationFn: (body: { name?: string; visibility?: ShareVisibility }) =>
      updateSharedExercise(exercise.id, body),
    onError: () => alert('Failed to update the shared exercise. Please try again.'),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSharedExercise(exercise.id),
    onError: () => alert('Failed to unpublish the exercise. Please try again.'),
    onSuccess: invalidate,
  })

  const handleRename = (e: Event) => {
    const value = (e.target as HTMLInputElement).value.trim()
    if (value && value !== exercise.name) updateMutation.mutate({ name: value })
  }

  const handleDelete = () => {
    if (confirm(`Unpublish "${exercise.name}"? Its link will stop working.`)) deleteMutation.mutate()
  }

  return (
    <li class="shared-dashboard-row">
      <input
        class="shared-dashboard-name"
        type="text"
        value={exercise.name}
        onBlur={handleRename}
        aria-label="Exercise name"
      />
      <a
        class="shared-exercise-item"
        href={itemPageHref(exercise.activity_type, exercise.field, exercise.value)}
      >
        {exercise.value} · {toDisplayName(exercise.activity_type)}
      </a>
      <VisibilitySelector
        compact
        name={`exercise-visibility-${exercise.id}`}
        options={SHARE_VISIBILITY_OPTIONS}
        value={exercise.visibility}
        onChange={(visibility) => updateMutation.mutate({ visibility })}
      />
      <div class="shared-dashboard-actions">
        <a class="btn-secondary" href={exercise.share_url} target="_blank" rel="noopener noreferrer">
          View
        </a>
        <button class="btn-secondary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button class="btn-danger" onClick={handleDelete}>
          Unpublish
        </button>
      </div>
    </li>
  )
}

function SharedExercises() {
  const query = useQuery({
    queryFn: listSharedExercises,
    queryKey: ['sharedExercises'],
    staleTime: 60 * 1000,
  })
  const exercises = query.data ?? []

  return (
    <section class="shared-exercises">
      <h2>Exercises</h2>
      <p class="shared-dashboards-intro">
        Share one exercise’s progress from its page (an exercise under an activity type).
      </p>
      {query.isLoading && <div class="loading">Loading…</div>}
      {!query.isLoading &&
        (exercises.length === 0 ? (
          <p class="shared-dashboards-empty">You haven’t shared any exercises yet.</p>
        ) : (
          <ul class="shared-dashboards-list">
            {exercises.map((e) => (
              <SharedExerciseRow key={e.id} exercise={e} />
            ))}
          </ul>
        ))}
    </section>
  )
}

export function Dashboards() {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [preset, setPreset] = useState<DashboardPreset>('blank')
  const [name, setName] = useState(presetName('blank'))

  const query = useQuery({
    queryFn: listSharedDashboards,
    queryKey: ['sharedDashboards'],
    staleTime: 60 * 1000,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createSharedDashboard({
        name: name.trim() || presetName(preset),
        period_lock: 'latest',
        preset,
        visibility: 'private',
      }),
    onError: () => alert('Failed to create the dashboard. Please try again.'),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['sharedDashboards'] })
      route(dashboardPath(created.slug))
    },
  })

  const handlePresetChange = (next: DashboardPreset) => {
    setName((current) => nameAfterPresetChange(current, preset, next))
    setPreset(next)
  }

  const dashboards = query.data ?? []

  return (
    <div class="shared-dashboards">
      <div class="shared-dashboards-header">
        <h1>Dashboards</h1>
      </div>

      <p class="shared-dashboards-intro">
        Your home dashboard and any others you make. A dashboard is only yours until you choose otherwise:
        anyone with the link can open an unlisted one, and public ones are listed on your profile.
      </p>

      <div class="shared-dashboards-create">
        <input
          type="text"
          value={name}
          placeholder="New dashboard name"
          aria-label="New dashboard name"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <select
          value={preset}
          aria-label="Start from"
          onChange={(e) => {
            const next = PRESET_OPTIONS.find((o) => o.value === (e.target as HTMLSelectElement).value)
            if (next) handlePresetChange(next.value)
          }}
        >
          {PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          class="btn-primary"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          Create
        </button>
      </div>

      <ul class="shared-dashboards-list">
        <HomeDashboardRow />
        {dashboards.map((d) => (
          <SharedDashboardRow key={d.id} dashboard={d} />
        ))}
      </ul>
      {query.isLoading && <div class="loading">Loading…</div>}

      <SharedExercises />
    </div>
  )
}
