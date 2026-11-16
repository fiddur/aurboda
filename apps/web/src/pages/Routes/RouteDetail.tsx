import type { RouteDetail as RouteDetailData, RouteEffort } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useMemo, useState } from 'preact/hooks'

import { RouteMap } from '../../components/charts/RouteMap'
import { ConfirmButton } from '../../components/ConfirmButton'
import { MiniTrendChart } from '../../components/MiniTrendChart'
import { SaveStatusIndicator, useSaveStatus } from '../../components/SaveStatusIndicator'
import { deleteRoute, fetchRoute, fetchRoutes, mergeRoutes, updateRoute } from '../../state/api'
import { auth } from '../../state/auth'
import { CHART_PRIMARY } from '../../theme'
import { cumulativeDistancesM, indexRangeForKm } from '../../utils/segmentCut'
import { formatDistance, formatPace } from '../EntityDetail/format-utils'
import { CreateSegmentForm } from '../Segments/CreateSegmentForm'
import { ActivityTypeName } from './ActivityTypeName'
import { effortSeries, effortsWithCategory, formatElapsed } from './format'
import '../DataSources/style.css'
import './style.css'

/** RouteMap draws a line from timed points; a route line has no times and is never hovered. */
const NO_TIME = new Date(0)

const MIN_TREND_POINTS = 2

const INITIAL_CUT_KM = 1

interface KmCut {
  start: string
  end: string
}

const parseKm = (value: string): number => {
  const km = Number(value)
  return Number.isFinite(km) && km > 0 ? km : 0
}

function RouteCutPanel({
  route,
  cut,
  onCutChange,
  onCancel,
}: {
  route: RouteDetailData
  cut: KmCut
  onCutChange: (cut: KmCut) => void
  onCancel: () => void
}) {
  const maxKm = Math.ceil(route.length_m / 100) / 10
  const startKm = parseKm(cut.start)
  const endKm = parseKm(cut.end)
  const lengthM = Math.max(0, Math.min(endKm * 1000, route.length_m) - startKm * 1000)
  const kmInput = (edge: keyof KmCut, label: string) => (
    <label class="segment-cut-km">
      {label}
      <input
        type="number"
        min={0}
        max={maxKm}
        step={0.1}
        value={cut[edge]}
        onInput={(e) => onCutChange({ ...cut, [edge]: (e.target as HTMLInputElement).value })}
      />
    </label>
  )
  return (
    <div class="segment-create-panel">
      <div class="segment-cut-kms">
        {kmInput('start', 'From km')}
        {kmInput('end', 'To km')}
      </div>
      <CreateSegmentForm
        cut={{ end_km: endKm, route_id: route.id, start_km: startKm }}
        lengthM={lengthM}
        onCancel={onCancel}
      />
    </div>
  )
}

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

function EffortsTable({ efforts }: { efforts: RouteEffort[] }) {
  if (efforts.length === 0) return <p class="routes-empty">No runs on this route.</p>
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
        {efforts.map((effort) => (
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

function Trends({ efforts }: { efforts: RouteEffort[] }) {
  const pace = effortSeries(efforts, 'pace_s_per_km')
  const hr = effortSeries(efforts, 'avg_hr')
  if (pace.length < MIN_TREND_POINTS && hr.length < MIN_TREND_POINTS) return null
  return (
    <section class="route-section">
      <h2>Over time</h2>
      {pace.length >= MIN_TREND_POINTS && (
        <>
          <h3>Pace (min/km)</h3>
          <MiniTrendChart data={pace} color={CHART_PRIMARY} />
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

  const { data: routes = [] } = useQuery({ queryFn: () => fetchRoutes(), queryKey: ['routes'] })
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
        confirmMessage={`Delete route "${route.name}"? Its runs are kept and will not be matched into a route again.`}
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
  const [lowHrOnly, setLowHrOnly] = useState(false)

  const { data: route, isLoading } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchRoute(id),
    queryKey: ['route', id],
  })
  const [kmCut, setKmCut] = useState<KmCut | null>(null)
  const mapPoints = useMemo(() => route?.points.map((p) => ({ ...p, time: NO_TIME })) ?? [], [route?.points])
  const distancesM = useMemo(() => cumulativeDistancesM(mapPoints), [mapPoints])

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

  const lowHr = effortsWithCategory(route.efforts, 'low_hr')
  const efforts = lowHrOnly && lowHr.length > 0 ? lowHr : route.efforts

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <NameEditor route={route} />
        <p class="page-subtitle">
          <ActivityTypeName name={route.activity_type} /> · {formatDistance(route.length_m)} ·{' '}
          {route.activity_count} {route.activity_count === 1 ? 'run' : 'runs'}
        </p>
        <a href="/routes" class="route-back-link">
          Back to routes
        </a>
      </div>

      <RouteMap
        points={mapPoints}
        hoverTime={null}
        highlight={kmCut && indexRangeForKm(distancesM, parseKm(kmCut.start), parseKm(kmCut.end))}
      />

      {kmCut ? (
        <RouteCutPanel route={route} cut={kmCut} onCutChange={setKmCut} onCancel={() => setKmCut(null)} />
      ) : (
        <div class="segment-create-open">
          <button
            type="button"
            class="btn-secondary"
            onClick={() =>
              setKmCut({
                end: String(Math.min(INITIAL_CUT_KM, Math.ceil(route.length_m / 100) / 10)),
                start: '0',
              })
            }
          >
            Create segment
          </button>
        </div>
      )}

      {lowHr.length > 0 && (
        <label class="route-low-hr-toggle">
          <input
            type="checkbox"
            checked={lowHrOnly}
            onChange={(e) => setLowHrOnly((e.target as HTMLInputElement).checked)}
          />{' '}
          Low-HR runs only
        </label>
      )}

      <Trends efforts={efforts} />

      <section class="route-section">
        <h2>Runs</h2>
        <EffortsTable efforts={efforts} />
      </section>

      <ManageRoute route={route} />
    </div>
  )
}
