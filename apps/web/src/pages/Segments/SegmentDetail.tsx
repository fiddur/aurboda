import type { SegmentDetail as SegmentDetailData, SegmentEffort } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useMemo, useState } from 'preact/hooks'

import { RouteMap } from '../../components/charts/RouteMap'
import { ConfirmButton } from '../../components/ConfirmButton'
import { MiniTrendChart } from '../../components/MiniTrendChart'
import { SaveStatusIndicator, useSaveStatus } from '../../components/SaveStatusIndicator'
import { deleteSegment, fetchSegment, matchSegment, updateSegment } from '../../state/api'
import { auth } from '../../state/auth'
import { CHART_PRIMARY } from '../../theme'
import { formatDistance, formatPace } from '../EntityDetail/format-utils'
import { ActivityTypeName } from '../Routes/ActivityTypeName'
import { formatElapsed } from '../Routes/format'
import '../DataSources/style.css'
import '../Routes/style.css'
import { formatEffortCount, formatMatchResult, segmentEffortSeries } from './format'
import './style.css'

/** RouteMap draws a line from timed points; a segment line has no times and is never hovered. */
const NO_TIME = new Date(0)

const MIN_TREND_POINTS = 2

function NameEditor({ segment }: { segment: SegmentDetailData }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(segment.name)
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  useEffect(() => setName(segment.name), [segment.name])

  const renameMutation = useMutation({
    mutationFn: (next: string) => updateSegment(segment.id, { name: next }),
    onError: () => setSaveStatus({ status: 'error' }),
    onMutate: () => setSaveStatus({ status: 'saving' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['segments'] })
      queryClient.invalidateQueries({ queryKey: ['segment', segment.id] })
    },
  })

  const save = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== segment.name) renameMutation.mutate(trimmed)
    else setName(segment.name)
  }

  return (
    <div class="route-name-row">
      <input
        class="route-name-input"
        aria-label="Segment name"
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

function EffortsTable({ efforts }: { efforts: SegmentEffort[] }) {
  if (efforts.length === 0) return <p class="routes-empty">No efforts on this segment yet.</p>
  return (
    <div class="segment-efforts-scroll">
      <table class="route-efforts">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Pace</th>
            <th>Avg HR</th>
            <th>
              <span class="segment-visually-hidden">Notes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {efforts.map((effort) => (
            <tr key={`${effort.activity_id}:${effort.start_offset_s}`}>
              <td>
                <a href={`/detail/activity/${effort.activity_id}`}>
                  {format(new Date(effort.activity_start_time), 'yyyy-MM-dd HH:mm')}
                </a>
              </td>
              <td>{formatElapsed(effort.elapsed_s)}</td>
              <td>{formatPace(effort.pace_s_per_km) ?? '—'}</td>
              <td>{effort.avg_hr === null ? '—' : Math.round(effort.avg_hr)}</td>
              <td>
                {effort.is_best && <span class="segment-best">★ best</span>}
                {effort.is_best && effort.approximate && ' '}
                {effort.approximate && <span class="segment-approximate">approximate</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Trend({ efforts }: { efforts: SegmentEffort[] }) {
  const series = useMemo(() => segmentEffortSeries(efforts), [efforts])
  if (series.length < MIN_TREND_POINTS) return null
  return (
    <section class="route-section">
      <h2>Over time</h2>
      <h3>Time (min)</h3>
      <MiniTrendChart data={series} color={CHART_PRIMARY} />
    </section>
  )
}

function CutFrom({ segment }: { segment: SegmentDetailData }) {
  if (segment.created_from_activity_id) {
    return (
      <p class="segment-cut-from">
        Cut from <a href={`/detail/activity/${segment.created_from_activity_id}`}>an activity</a>.
      </p>
    )
  }
  if (segment.created_from_route_id) {
    return (
      <p class="segment-cut-from">
        Cut from <a href={`/routes/${segment.created_from_route_id}`}>a route</a>.
      </p>
    )
  }
  return null
}

function ManageSegment({ segment }: { segment: SegmentDetailData }) {
  const { route: navigate } = useLocation()
  const queryClient = useQueryClient()

  const matchMutation = useMutation({
    mutationFn: () => matchSegment(segment.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments'] })
      queryClient.invalidateQueries({ queryKey: ['segment', segment.id] })
      queryClient.invalidateQueries({ queryKey: ['entity-detail', 'activity'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSegment(segment.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments'] })
      queryClient.invalidateQueries({ queryKey: ['entity-detail', 'activity'] })
      navigate('/segments')
    },
  })

  return (
    <section class="route-section route-manage">
      <div class="segment-match">
        <button
          type="button"
          class="btn-secondary"
          disabled={matchMutation.isPending}
          onClick={() => matchMutation.mutate()}
        >
          {matchMutation.isPending ? 'Timing...' : 'Time again'}
        </button>
        {matchMutation.isSuccess && (
          <span class="segment-match-result" role="status">
            {formatMatchResult(matchMutation.data)}
          </span>
        )}
        {matchMutation.isError && (
          <span class="segment-match-result segment-create-error">Timing failed</span>
        )}
      </div>
      <ConfirmButton
        label="Delete Segment"
        confirmMessage={`Delete segment "${segment.name}" and all its efforts?`}
        onConfirm={() => deleteMutation.mutate()}
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
      />
    </section>
  )
}

export function SegmentDetail() {
  const { params } = useRoute()
  const id = params.id as string

  const { data: segment, isLoading } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchSegment(id),
    queryKey: ['segment', id],
  })
  const mapPoints = useMemo(
    () => segment?.points.map((p) => ({ ...p, time: NO_TIME })) ?? [],
    [segment?.points],
  )

  if (!auth.value.token) {
    return (
      <div class="data-sources-page">
        <p>Please log in to see your segments.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div class="data-sources-page">
        <p class="loading">Loading segment...</p>
      </div>
    )
  }

  if (!segment) {
    return (
      <div class="data-sources-page">
        <p>Segment not found.</p>
        <a href="/segments">Back to segments</a>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <NameEditor segment={segment} />
        <p class="page-subtitle">
          <ActivityTypeName name={segment.activity_type} /> · {formatDistance(segment.length_m)} ·{' '}
          {formatEffortCount(segment.effort_count)}
          {segment.best_elapsed_s !== null && <> · best {formatElapsed(segment.best_elapsed_s)}</>}
        </p>
        <CutFrom segment={segment} />
        <a href="/segments" class="route-back-link">
          Back to segments
        </a>
      </div>

      <RouteMap points={mapPoints} hoverTime={null} />

      <Trend efforts={segment.efforts} />

      <section class="route-section">
        <h2>Efforts</h2>
        <EffortsTable efforts={segment.efforts} />
      </section>

      <ManageSegment segment={segment} />
    </div>
  )
}
