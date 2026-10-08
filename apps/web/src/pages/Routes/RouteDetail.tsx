import type { RouteDetail as RouteDetailData } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import { RouteMap } from '../../components/charts/RouteMap'
import { ConfirmButton } from '../../components/ConfirmButton'
import { MiniTrendChart } from '../../components/MiniTrendChart'
import { SaveStatusIndicator, useSaveStatus } from '../../components/SaveStatusIndicator'
import { deleteRoute, fetchRoute, fetchRoutes, mergeRoutes, updateRoute } from '../../state/api'
import { auth } from '../../state/auth'
import { formatDistance, formatPace } from '../EntityDetail/format-utils'
import { effortSeries, formatElapsed } from './format'
import './style.css'

/** RouteMap draws a line from timed points; a route line has no times and is never hovered. */
const NO_TIME = new Date(0)

const MIN_TREND_POINTS = 2

function NameEditor({ route }: { route: RouteDetailData }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(route.name)
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  useEffect(() => setName(route.name), [route.name])

  const renameMutation = useMutation({
    mutationFn: (next: string) => updateRoute(route.id, { name: next }),
    onError: () => setSaveStatus({ status: 'error' }),
    onMutate: () => setSaveStatus({ status: 'saving' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['route', route.id] })
    },
  })

  const save = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== route.name) renameMutation.mutate(trimmed)
    else setName(route.name)
  }

  return (
    <div class="route-name-row">
      <input
        class="route-name-input"
        aria-label="Route name"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <SaveStatusIndicator state={saveStatus} variant="compact" />
    </div>
  )
}

function EffortsTable({ route }: { route: RouteDetailData }) {
  if (route.efforts.length === 0) return <p class="routes-empty">No runs on this route.</p>
  return (
    <table class="route-efforts">
      <thead>
        <tr>
          <th>Date</th>
          <th>Elapsed</th>
          <th>Avg HR</th>
          <th>Pace</th>
        </tr>
      </thead>
      <tbody>
        {route.efforts.map((effort) => (
          <tr key={effort.activity_id}>
            <td>
              <a href={`/detail/activity/${effort.activity_id}`}>
                {format(new Date(effort.start_time), 'yyyy-MM-dd HH:mm')}
              </a>
            </td>
            <td>{formatElapsed(effort.elapsed_s)}</td>
            <td>{effort.avg_hr === undefined ? '—' : Math.round(effort.avg_hr)}</td>
            <td>{formatPace(effort.pace_s_per_km) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Trends({ route }: { route: RouteDetailData }) {
  const pace = effortSeries(route.efforts, 'pace_s_per_km')
  const hr = effortSeries(route.efforts, 'avg_hr')
  if (pace.length < MIN_TREND_POINTS && hr.length < MIN_TREND_POINTS) return null
  return (
    <section class="route-section">
      <h2>Over time</h2>
      {pace.length >= MIN_TREND_POINTS && (
        <>
          <h3>Pace (min/km)</h3>
          <MiniTrendChart data={pace} color="#673ab8" />
        </>
      )}
      {hr.length >= MIN_TREND_POINTS && (
        <>
          <h3>Average heart rate</h3>
          <MiniTrendChart data={hr} color="#ef4444" />
        </>
      )}
    </section>
  )
}

function ManageRoute({ route }: { route: RouteDetailData }) {
  const { route: navigate } = useLocation()
  const queryClient = useQueryClient()
  const [targetId, setTargetId] = useState('')

  const { data: routes = [] } = useQuery({ queryFn: fetchRoutes, queryKey: ['routes'] })
  const targets = routes.filter((r) => r.id !== route.id && r.activity_type === route.activity_type)

  const mergeMutation = useMutation({
    mutationFn: () => mergeRoutes(targetId, route.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      queryClient.invalidateQueries({ queryKey: ['route'] })
      navigate(`/routes/${targetId}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteRoute(route.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] })
      navigate('/routes')
    },
  })

  return (
    <section class="route-section route-manage">
      {targets.length > 0 && (
        <div class="route-merge">
          <label>
            Merge into{' '}
            <select value={targetId} onChange={(e) => setTargetId((e.target as HTMLSelectElement).value)}>
              <option value="">Choose a route…</option>
              {targets.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.activity_count})
                </option>
              ))}
            </select>
          </label>
          <ConfirmButton
            label="Merge"
            buttonClass="btn-secondary"
            confirmMessage="Move every run to the chosen route and delete this one?"
            onConfirm={() => mergeMutation.mutate()}
            isPending={mergeMutation.isPending}
            pendingLabel="Merging..."
            disabled={!targetId}
          />
        </div>
      )}
      <ConfirmButton
        label="Delete Route"
        confirmMessage={`Delete route "${route.name}"? Its activities are kept.`}
        onConfirm={() => deleteMutation.mutate()}
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
      />
    </section>
  )
}

export function RouteDetail() {
  const { params } = useRoute()
  const id = params.id as string

  const { data: route, isLoading } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchRoute(id),
    queryKey: ['route', id],
  })

  if (!auth.value.token) {
    return (
      <div class="data-sources-page">
        <p>Please log in to see your routes.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div class="data-sources-page">
        <p class="loading">Loading route...</p>
      </div>
    )
  }

  if (!route) {
    return (
      <div class="data-sources-page">
        <p>Route not found.</p>
        <a href="/routes">Back to routes</a>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <NameEditor route={route} />
        <p class="page-subtitle">
          {route.activity_type} · {formatDistance(route.length_m)} · {route.activity_count}{' '}
          {route.activity_count === 1 ? 'run' : 'runs'}
        </p>
        <a href="/routes" class="route-back-link">
          Back to routes
        </a>
      </div>

      <RouteMap points={route.points.map((p) => ({ ...p, time: NO_TIME }))} hoverTime={null} />

      <Trends route={route} />

      <section class="route-section">
        <h2>Runs</h2>
        <EffortsTable route={route} />
      </section>

      <ManageRoute route={route} />
    </div>
  )
}
