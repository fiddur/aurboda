import type { LastSleepConfig, LatestSleep } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { useQuery } from '@tanstack/react-query'

import { fetchLatestSleep } from '../../state/api'
import { formatMinutesAsHM } from '../charts/sleep-utils'
import {
  type Delta,
  delta,
  formatDelta,
  formatSleepRange,
  stageBreakdown,
  stageStripSegments,
} from './lastSleep'

interface LastSleepViewProps {
  config: LastSleepConfig
  data: LatestSleep | null
  loading?: boolean
  /** Link to the sleep's detail page; off on public boards, which cannot open the owner's app. */
  linkToDetail?: boolean
}

const deltaClass = (d: Delta, lowerIsBetter: boolean): string => {
  if (d.amount === 0) return 'trend-neutral'
  return (d.arrow === '↓') === lowerIsBetter ? 'trend-positive' : 'trend-negative'
}

function Vital({
  children,
  d,
  label,
  lowerIsBetter = false,
}: {
  children: ComponentChildren
  d?: Delta
  label: string
  lowerIsBetter?: boolean
}) {
  return (
    <div class="last-sleep-vital">
      <span class="last-sleep-vital-label">{label}</span>
      <span class="last-sleep-vital-value">
        {children}
        {d && (
          <span
            class={`trend-indicator ${deltaClass(d, lowerIsBetter)}`}
            title="Compared with 30-day average"
          >
            {formatDelta(d)}
          </span>
        )}
      </span>
    </div>
  )
}

function SleepBody({ data }: { data: LatestSleep }) {
  const segments = stageStripSegments(data)
  const breakdown = stageBreakdown(data.stage_minutes)
  const battery =
    data.body_battery_start !== undefined && data.body_battery_end !== undefined
      ? data.body_battery_end - data.body_battery_start
      : undefined

  return (
    <>
      <div class="last-sleep-headline">
        {data.sleep_score !== undefined && (
          <span class="metric-value">
            <span class="value">{Math.round(data.sleep_score)}</span>
            <span class="unit">score</span>
          </span>
        )}
        <span class="metric-value">
          <span class="value">{formatMinutesAsHM(data.total_sleep_min ?? data.time_in_bed_min)}</span>
          <span class="unit">{data.total_sleep_min !== undefined ? 'asleep' : 'in bed'}</span>
        </span>
      </div>

      {segments.length > 0 && (
        <div class="last-sleep-strip" role="img" aria-label="Sleep stages">
          {segments.map((s) => (
            <span
              key={`${s.left}-${s.width}`}
              class="last-sleep-segment"
              style={{ background: s.color, left: `${s.left}%`, width: `${s.width}%` }}
              title={s.title}
            />
          ))}
        </div>
      )}

      {breakdown.length > 0 && (
        <div class="last-sleep-stages">
          {breakdown.map((s) => (
            <span key={s.label} class="last-sleep-stage">
              <span class="last-sleep-dot" style={{ background: s.color }} />
              {s.label} {formatMinutesAsHM(s.minutes)}
            </span>
          ))}
        </div>
      )}

      <div class="last-sleep-vitals">
        {data.resting_hr !== undefined && (
          <Vital label="Resting HR" d={delta(data.resting_hr, data.resting_hr_baseline)} lowerIsBetter>
            {Math.round(data.resting_hr)} <span class="unit">bpm</span>
          </Vital>
        )}
        {data.hrv !== undefined && (
          <Vital label="HRV" d={delta(data.hrv, data.hrv_baseline)}>
            {Math.round(data.hrv)} <span class="unit">ms</span>
          </Vital>
        )}
        {data.body_battery_start !== undefined && data.body_battery_end !== undefined && (
          <Vital label="Body Battery">
            {data.body_battery_start} → {data.body_battery_end}
            {battery !== undefined && (
              <span class="unit">
                {' '}
                ({battery >= 0 ? '+' : ''}
                {battery})
              </span>
            )}
          </Vital>
        )}
      </div>
    </>
  )
}

export function LastSleepView({ config, data, linkToDetail = false, loading = false }: LastSleepViewProps) {
  const title = config.title ?? 'Last night'

  return (
    <div class="metric-card last-sleep">
      <div class="metric-header">
        <span class="metric-title">{title}</span>
        {data && (
          <span class="metric-subtitle">
            {formatSleepRange(data)}
            {linkToDetail && (
              <>
                {' · '}
                <a href={`/detail/activity/${encodeURIComponent(data.activity_id)}`} class="last-sleep-link">
                  Details
                </a>
              </>
            )}
          </span>
        )}
      </div>
      {loading ? (
        <span class="loading-placeholder">...</span>
      ) : data ? (
        <SleepBody data={data} />
      ) : (
        <span class="no-data">No sleep recorded in the last 36 hours</span>
      )}
    </div>
  )
}

export function LastSleepWidget({ config }: { config: LastSleepConfig }) {
  const query = useQuery({
    queryFn: fetchLatestSleep,
    queryKey: ['latestSleep'],
    staleTime: 5 * 60 * 1000,
  })

  return <LastSleepView config={config} data={query.data ?? null} loading={query.isLoading} linkToDetail />
}
