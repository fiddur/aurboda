/**
 * SharedDashboards - manage the current user's published dashboards.
 *
 * Create a shareable copy (seeded from the home dashboard or blank), toggle
 * public/unlisted, copy the share link, rename (auto-saves on blur), delete.
 * Per-widget editing of a shared dashboard is a follow-up; today a share is
 * seeded from the home dashboard's current layout. Below them, the exercises
 * shared from their exercise pages.
 */
import type { DashboardConfig, ShareVisibility, SharedDashboard, SharedExercise } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { itemPageHref } from '../../components/sessions/sessionView'
import { useCopyLink } from '../../components/ShareControls'
import { SHARE_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import {
  createSharedDashboard,
  deleteSharedDashboard,
  deleteSharedExercise,
  fetchDashboard,
  listSharedDashboards,
  listSharedExercises,
  updateSharedDashboard,
  updateSharedExercise,
} from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import './style.css'

function SharedDashboardRow({ dashboard }: { dashboard: SharedDashboard }) {
  const queryClient = useQueryClient()
  const { copied, copy: handleCopy } = useCopyLink(dashboard.share_url)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sharedDashboards'] })

  const updateMutation = useMutation({
    mutationFn: (body: { name?: string; visibility?: ShareVisibility }) =>
      updateSharedDashboard(dashboard.id, body),
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
      <VisibilitySelector
        compact
        name={`dashboard-visibility-${dashboard.id}`}
        options={SHARE_VISIBILITY_OPTIONS}
        value={dashboard.visibility}
        onChange={(visibility) => updateMutation.mutate({ visibility })}
      />
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
      return createSharedDashboard({
        config,
        name: name.trim() || 'Shared dashboard',
        visibility: 'unlisted',
      })
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

      <SharedExercises />
    </div>
  )
}
