import type { RecoveryZones, TrainingLoadPoint, TrainingLoadResult, WorkoutTrimp } from '@aurboda/api-spec'

import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import { format, startOfDay, subDays } from 'date-fns'
import { useState } from 'preact/hooks'

import { fetchTrainingLoad } from '../../state/api'
import { auth } from '../../state/auth'
import {
  formState,
  newestFirst,
  RECOVERY_ZONE_LABELS,
  RECOVERY_ZONES,
  type RecoveryZone,
  recoveryZone,
  zoneSegments,
} from '../../utils/trainingLoad'
import { ATL_COLOR, CTL_COLOR, TSB_FATIGUED_COLOR, TSB_FRESH_COLOR } from '../Timeline/drawTrainingLoadTrack'
import { TrainingLoadChart } from './TrainingLoadChart'
import './style.css'

const RANGES = [30, 90, 180, 365]
const WORKOUTS_SHOWN = 20
const daysBack = signal(90)

const ZONE_MEANINGS: Record<RecoveryZone, string> = {
  balanced: 'Optimal training range.',
  strained: 'Elevated fatigue: risk of overreaching.',
  undertrained: 'Not training enough to maintain your current fitness.',
  very_strained: 'Very high fatigue: high risk of overtraining.',
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
const day = (iso: string) => format(new Date(iso), 'MMM d')

function FormSummary({ point, zones }: { point: TrainingLoadPoint; zones?: RecoveryZones }) {
  const form = formState(point.tsb)
  const zone = zones ? recoveryZone(point.atl, zones) : null
  const gap = Math.abs(point.tsb).toFixed(1)
  return (
    <section class="tl-summary">
      <div class={`tl-form tl-form-${form}`}>
        <div class="tl-form-label">{form === 'fresh' ? 'Fresh' : 'Fatigued'}</div>
        <p>
          {form === 'fresh'
            ? `Your fitness exceeds your recent fatigue by ${gap}: a good time for a hard session.`
            : `Your recent training exceeds your fitness base by ${gap}: easier days let your form recover.`}
        </p>
        {zone && (
          <p class="tl-zone-now">
            <span class={`tl-zone-dot tl-zone-${zone}`} /> {RECOVERY_ZONE_LABELS[zone]}: {ZONE_MEANINGS[zone]}
          </p>
        )}
      </div>
      <div class="tl-stats">
        <div class="tl-stat">
          <div class="tl-stat-label">Fitness (CTL)</div>
          <div class="tl-stat-value" style={{ color: CTL_COLOR }}>
            {point.ctl.toFixed(1)}
          </div>
        </div>
        <div class="tl-stat">
          <div class="tl-stat-label">Fatigue (ATL)</div>
          <div class="tl-stat-value" style={{ color: ATL_COLOR }}>
            {point.atl.toFixed(1)}
          </div>
        </div>
        <div class="tl-stat">
          <div class="tl-stat-label">Form (TSB)</div>
          <div
            class="tl-stat-value"
            style={{ color: form === 'fresh' ? TSB_FRESH_COLOR : TSB_FATIGUED_COLOR }}
          >
            {signed(point.tsb)}
          </div>
        </div>
      </div>
    </section>
  )
}

function ZoneTimeline({ points, zones }: { points: TrainingLoadPoint[]; zones?: RecoveryZones }) {
  if (!zones) {
    return (
      <p class="tl-muted">
        Recovery zones appear after about six weeks of training data, once your fitness (CTL) is meaningful.
      </p>
    )
  }
  const segments = zoneSegments(points, zones)
  return (
    <>
      <div class="tl-zone-strip">
        {segments.map((s) => (
          <span
            key={s.start}
            class={`tl-zone-segment tl-zone-${s.zone}`}
            style={{ flexGrow: s.count }}
            title={`${RECOVERY_ZONE_LABELS[s.zone]}: ${day(s.start)}${s.start === s.end ? '' : ` – ${day(s.end)}`}`}
          />
        ))}
      </div>
      <div class="tl-zone-axis">
        <span>{day(points[0].time)}</span>
        <span>{day(points[points.length - 1].time)}</span>
      </div>
      <div class="tl-legend">
        {RECOVERY_ZONES.map((zone) => (
          <span key={zone} class="tl-legend-item">
            <span class={`tl-zone-dot tl-zone-${zone}`} /> {RECOVERY_ZONE_LABELS[zone]}
          </span>
        ))}
      </div>
    </>
  )
}

function WorkoutsTable({ workouts }: { workouts: WorkoutTrimp[] }) {
  const [showAll, setShowAll] = useState(false)
  if (workouts.length === 0) return <p class="tl-muted">No workouts in this range.</p>
  const sorted = newestFirst(workouts)
  const shown = showAll ? sorted : sorted.slice(0, WORKOUTS_SHOWN)
  const maxTrimp = Math.max(...workouts.map((w) => w.trimp), 1)
  return (
    <>
      <table class="tl-workouts">
        <thead>
          <tr>
            <th>Date</th>
            <th>Workout</th>
            <th class="tl-wide">Duration</th>
            <th class="tl-wide">Avg HR</th>
            <th>TRIMP</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((w) => {
            const meta = [
              `${Math.round(w.duration_minutes)} min`,
              ...(w.avg_hr ? [`${Math.round(w.avg_hr)} bpm`] : []),
            ].join(' · ')
            const estimated = w.trimp_basis === 'duration_estimate'
            return (
              <tr key={w.activity_id ?? w.start_time}>
                <td class="tl-date">{format(new Date(w.start_time), 'EEE MMM d')}</td>
                <td>
                  {w.activity_id ? (
                    <a href={`/detail/activity/${encodeURIComponent(w.activity_id)}`}>
                      {w.title ?? 'Workout'}
                    </a>
                  ) : (
                    (w.title ?? 'Workout')
                  )}
                  <div class="tl-narrow tl-muted">{meta}</div>
                </td>
                <td class="tl-wide">{Math.round(w.duration_minutes)} min</td>
                <td class="tl-wide">{w.avg_hr ? `${Math.round(w.avg_hr)} bpm` : '–'}</td>
                <td class="tl-trimp">
                  <div class="tl-trimp-cell">
                    <span
                      class="tl-trimp-value"
                      title={estimated ? 'Estimated from duration (no usable heart rate)' : undefined}
                    >
                      {Math.round(w.trimp)}
                      {estimated && '*'}
                    </span>
                    <span class="tl-trimp-track">
                      <span class="tl-trimp-bar" style={{ width: `${(w.trimp / maxTrimp) * 100}%` }} />
                    </span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {sorted.some((w) => w.trimp_basis === 'duration_estimate') && (
        <p class="tl-muted tl-footnote">
          * Estimated from duration: no usable heart rate during the workout.
        </p>
      )}
      {sorted.length > WORKOUTS_SHOWN && (
        <button type="button" class="tl-show-all" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${sorted.length} workouts`}
        </button>
      )}
    </>
  )
}

function EstimatedNote({ data }: { data: TrainingLoadResult }) {
  const { estimated_impulse: basis } = data
  if (basis.estimated_workouts === 0 || basis.estimated_share === null) return null
  return (
    <p class="tl-note">
      {basis.estimated_workouts} of {basis.workouts} workouts in this range (
      {Math.round(basis.estimated_share * 100)}% of their TRIMP) are estimated from duration, so fitness and
      fatigue are partly guessed.
    </p>
  )
}

function LoadOverview({ data }: { data: TrainingLoadResult }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const { points } = data
  const latest = points.at(-1)
  if (!latest || !points.some((p) => p.ctl > 0 || p.atl > 0)) {
    return (
      <p class="tl-muted">
        No training load in this range yet. It builds from exercise sessions (scored from heart rate when it
        was recorded) and active calories.
      </p>
    )
  }
  const readout = (hoverIndex !== null ? points[hoverIndex] : undefined) ?? latest
  return (
    <>
      <FormSummary point={latest} zones={data.zones} />
      {data.bootstrapping && (
        <p class="tl-note">
          Less than six weeks of data: fitness (CTL, dashed) is still building and is not yet meaningful.
        </p>
      )}
      <EstimatedNote data={data} />

      <section class="tl-section">
        <h2>Fitness, fatigue and form</h2>
        <div class="tl-legend">
          <span class="tl-legend-item">
            <span class="tl-swatch" style={{ background: CTL_COLOR }} /> Fitness (CTL)
          </span>
          <span class="tl-legend-item">
            <span class="tl-swatch" style={{ background: ATL_COLOR }} /> Fatigue (ATL)
          </span>
          <span class="tl-legend-item">
            <span class="tl-swatch" style={{ background: TSB_FRESH_COLOR }} />
            <span class="tl-swatch" style={{ background: TSB_FATIGUED_COLOR }} /> Form (TSB)
          </span>
        </div>
        <TrainingLoadChart points={points} bootstrapping={data.bootstrapping} onHover={setHoverIndex} />
        <p class="tl-readout">
          <strong>{format(new Date(readout.time), 'EEE MMM d')}</strong> · Fitness {readout.ctl.toFixed(1)} ·
          Fatigue {readout.atl.toFixed(1)} · Form {signed(readout.tsb)}
          {readout.training_impulse > 0 && ` · Training ${readout.training_impulse.toFixed(0)}`}
        </p>
      </section>

      <section class="tl-section">
        <h2>Recovery zones</h2>
        <ZoneTimeline points={points} zones={data.zones} />
      </section>
    </>
  )
}

export function TrainingLoad() {
  const isLoggedIn = Boolean(auth.value.token)
  const days = daysBack.value

  const { data, isLoading, error } = useQuery({
    enabled: isLoggedIn,
    queryFn: () => fetchTrainingLoad(startOfDay(subDays(new Date(), days)), new Date(), '1d'),
    queryKey: ['trainingLoadPage', days],
    staleTime: 5 * 60 * 1000,
  })

  if (!isLoggedIn) {
    return (
      <div class="training-load-page">
        <p>Please log in to see your training load.</p>
      </div>
    )
  }

  return (
    <div class="training-load-page">
      <div class="tl-header">
        <div>
          <h1>Training load</h1>
          <p class="tl-subtitle">
            Fitness, fatigue and form from your workouts and daily movement (Banister model).{' '}
            <a href="/settings#training-load">Time constants</a>
          </p>
        </div>
        <select
          class="tl-range"
          aria-label="Date range"
          value={days}
          onChange={(e) => {
            daysBack.value = parseInt((e.target as HTMLSelectElement).value, 10)
          }}
        >
          {RANGES.map((n) => (
            <option key={n} value={n}>
              Last {n} days
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p class="tl-muted">Loading training load...</p>}
      {error && <p class="tl-error">Could not load training load.</p>}

      {data && (
        <>
          <LoadOverview key={days} data={data} />
          <section class="tl-section">
            <h2>Workouts</h2>
            <WorkoutsTable workouts={data.workouts} />
          </section>
          <p class="tl-muted tl-footnote">
            Fatigue (ATL) uses a {data.settings.tau_acute ?? 7}-day time constant and fitness (CTL) a{' '}
            {data.settings.tau_chronic ?? 42}-day one.{' '}
            <a href="/settings#training-load">Change them in Settings</a>.
          </p>
        </>
      )}
    </div>
  )
}
