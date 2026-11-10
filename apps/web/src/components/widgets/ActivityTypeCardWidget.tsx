import type {
  ActivityTypeCardConfig,
  ActivityTypeCardData,
  ActivityTypeSleepSummary,
} from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { percentChange } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import { fetchActivityTypeSummary } from '../../state/api'
import {
  formatDistanceKm,
  formatHoursMinutes,
  formatPace,
  formatSpeed,
  speedDisplayFor,
} from './activityTypeCard'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'
import { TrendIndicator } from './TrendIndicator'

const DAY_MS = 86_400_000

const Change = ({ current, previous }: { current: number | null; previous: number | null | undefined }) =>
  previous === undefined ? null : <TrendIndicator value={percentChange(current, previous)} />

const Row = ({ label, value, change }: { label: string; value: string; change?: ComponentChildren }) => (
  <div class="activity-type-card-row">
    <span class="activity-type-card-label">{label}</span>
    <span class="activity-type-card-value">
      {value}
      {change}
    </span>
  </div>
)

const SpeedRow = ({ config, data }: { config: ActivityTypeCardConfig; data: ActivityTypeCardData }) => {
  if (speedDisplayFor(config) === 'pace') {
    return data.best_pace_sec_per_km === null ? null : (
      <Row label="Best pace" value={formatPace(data.best_pace_sec_per_km)} />
    )
  }
  return data.avg_speed_kmh === null ? null : (
    <Row label="Avg speed" value={formatSpeed(data.avg_speed_kmh)} />
  )
}

const stageRows = [
  { key: 'rem_min', label: 'REM' },
  { key: 'deep_min', label: 'Deep' },
  { key: 'light_min', label: 'Light' },
] as const

const SleepRows = ({
  previous,
  sleep,
}: {
  previous: number | null | undefined
  sleep: ActivityTypeSleepSummary
}) => (
  <>
    <Row
      label="Avg night"
      value={formatHoursMinutes(sleep.avg_minutes)}
      change={<Change current={sleep.avg_minutes} previous={previous} />}
    />
    <Row label="Best night" value={formatHoursMinutes(sleep.best_night_minutes)} />
    {stageRows.map(({ key, label }) => {
      const minutes = sleep.avg_stages?.[key]
      return minutes === undefined ? null : (
        <Row key={key} label={label} value={formatHoursMinutes(minutes)} />
      )
    })}
  </>
)

const Rows = ({ config, data }: { config: ActivityTypeCardConfig; data: ActivityTypeCardData }) => (
  <div class="activity-type-card-rows">
    <Row
      label="Time"
      value={formatHoursMinutes(data.total_minutes)}
      change={<Change current={data.total_minutes} previous={data.previous_total_minutes} />}
    />
    {data.distance_km !== null && (
      <Row
        label="Distance"
        value={formatDistanceKm(data.distance_km)}
        change={<Change current={data.distance_km} previous={data.previous_distance_km} />}
      />
    )}
    <SpeedRow config={config} data={data} />
    {data.sleep && <SleepRows previous={data.previous_sleep_avg_minutes} sleep={data.sleep} />}
  </div>
)

interface ActivityTypeCardViewProps {
  config: ActivityTypeCardConfig
  data: ActivityTypeCardData | null
  loading?: boolean
}

const Headline = ({ data, loading }: { data: ActivityTypeCardData | null; loading: boolean }) => {
  if (loading) return <span class="loading-placeholder">...</span>
  if (!data) return <span class="no-data">No data</span>
  return (
    <>
      <span class="value">{data.count}</span>
      <span class="unit">
        {data.sleep ? (data.count === 1 ? 'night' : 'nights') : data.count === 1 ? 'session' : 'sessions'}
      </span>
    </>
  )
}

export function ActivityTypeCardView({ config, data, loading = false }: ActivityTypeCardViewProps) {
  return (
    <div class="metric-card activity-type-card">
      <div class="metric-header">
        <span class="metric-title">{config.title ?? data?.activity_type_name ?? config.pattern}</span>
        {data && <Change current={data.count} previous={data.previous_count} />}
      </div>
      <div class="metric-value">
        <Headline data={data} loading={loading} />
      </div>
      {data && data.count > 0 && <Rows config={config} data={data} />}
    </div>
  )
}

export function ActivityTypeCardWidget({ config }: { config: ActivityTypeCardConfig }) {
  const { filter_field, filter_value, lookback_days = 30, pattern } = config

  const query = useQuery({
    queryFn: () => {
      const end = new Date()
      return fetchActivityTypeSummary(pattern, {
        end: end.toISOString(),
        start: new Date(end.getTime() - lookback_days * DAY_MS).toISOString(),
        ...(filter_field !== undefined && filter_value !== undefined ? { filter_field, filter_value } : {}),
      })
    },
    queryKey: ['activity-type-summary', pattern, filter_field, filter_value, lookback_days],
    ...HEAVY_QUERY_OPTIONS,
    staleTime: 5 * 60 * 1000,
  })

  return <ActivityTypeCardView config={config} data={query.data ?? null} loading={query.isLoading} />
}
