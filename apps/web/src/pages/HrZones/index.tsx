import { useQuery } from '@tanstack/react-query'
import { fetchPeriodSummary, fetchUserSettings, HrZoneThresholds, PeriodMetricStats } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

// Default HR zone thresholds (matching Android app)
const defaultHrZoneThresholds: HrZoneThresholds = {
  1: 86,
  2: 102,
  3: 118,
  4: 135,
  5: 151,
}

// Weekly target minutes per zone (matching Android app)
const hrZoneWeeklyTargetMinutes = [0, 60, 200, 60, 30, 10]

// HR Zone colors (matching Android app)
const hrZoneColors = [
  '#9E9E9E', // Zone 0: Gray - Below threshold
  '#64B5F6', // Zone 1: Light Blue - Warm-up
  '#4CAF50', // Zone 2: Green - Aerobic
  '#FFC107', // Zone 3: Amber - Tempo
  '#FF9800', // Zone 4: Orange - Threshold
  '#F44336', // Zone 5: Red - Max effort
]

const formatZoneTime = (seconds: number): string => {
  const totalMinutes = Math.floor(seconds / 60)
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`
  }
  return `${totalMinutes} min`
}

const formatBpmRange = (zoneIndex: number, thresholds: HrZoneThresholds): string => {
  const zoneStarts = [0, thresholds[1], thresholds[2], thresholds[3], thresholds[4], thresholds[5]]
  switch (zoneIndex) {
    case 0:
      return `< ${thresholds[1]} bpm`
    case 5:
      return `${thresholds[5]}+ bpm`
    default:
      return `${zoneStarts[zoneIndex]} - ${zoneStarts[zoneIndex + 1] - 1} bpm`
  }
}

const findMetricTimeSeconds = (metrics: PeriodMetricStats[], metricName: string): number => {
  const metric = metrics.find((m) => m.metric === metricName)
  return metric?.avg ?? 0
}

interface HrZoneBarProps {
  zoneIndex: number
  bpmRange: string
  timeSeconds: number
  targetMinutes: number
  color: string
}

function HrZoneBar({ zoneIndex, bpmRange, timeSeconds, targetMinutes, color }: HrZoneBarProps) {
  const progress = targetMinutes > 0 ? Math.min((timeSeconds / 60 / targetMinutes) * 100, 100) : 0
  const percentText = targetMinutes > 0 ? `${Math.round(progress)}%` : ''

  return (
    <div class="hr-zone-bar">
      <div class="hr-zone-header">
        <span class="hr-zone-label">
          Zone {zoneIndex} ({bpmRange})
        </span>
        <span class="hr-zone-time">{formatZoneTime(timeSeconds)}</span>
      </div>
      <div class="hr-zone-progress-container">
        <div class="hr-zone-progress-track" style={{ backgroundColor: `${color}33` }}>
          <div class="hr-zone-progress-bar" style={{ backgroundColor: color, width: `${progress}%` }} />
        </div>
        <span class="hr-zone-percent">{percentText}</span>
      </div>
    </div>
  )
}

export function HrZones() {
  const isLoggedIn = auth.value.token

  // Calculate date range: last 7 days including today
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 6)
  weekAgo.setHours(0, 0, 0, 0)

  const hrZoneMetrics = [
    'hr_zone_0_sec',
    'hr_zone_1_sec',
    'hr_zone_2_sec',
    'hr_zone_3_sec',
    'hr_zone_4_sec',
    'hr_zone_5_sec',
  ]

  const {
    data: periodSummary,
    isLoading: isLoadingSummary,
    error: summaryError,
  } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchPeriodSummary(weekAgo, today, hrZoneMetrics),
    queryKey: ['periodSummary', weekAgo.toISOString(), today.toISOString()],
  })

  const { data: userSettings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  if (!isLoggedIn) {
    return (
      <div class="hr-zones-page">
        <h1>HR Zone Minutes</h1>
        <p>Please log in to view your heart rate zone data.</p>
      </div>
    )
  }

  if (isLoadingSummary) {
    return (
      <div class="hr-zones-page">
        <h1>HR Zone Minutes</h1>
        <p class="loading">Loading...</p>
      </div>
    )
  }

  if (summaryError) {
    return (
      <div class="hr-zones-page">
        <h1>HR Zone Minutes</h1>
        <p class="error">Error loading data: {String(summaryError)}</p>
      </div>
    )
  }

  const thresholds = userSettings?.hr_zone_start ?? defaultHrZoneThresholds
  const metrics = periodSummary?.metrics ?? []

  return (
    <div class="hr-zones-page">
      <h1>HR Zone Minutes (Last 7 Days)</h1>
      <p class="description">
        Based on the Galpin/Huberman recommendation: aim for 150-200 minutes in Zone 2 (aerobic) and 5-10
        minutes in Zone 5 (max effort) per week.
      </p>

      <div class="hr-zones-list">
        {[0, 1, 2, 3, 4, 5].map((zoneIndex) => {
          const metricName = `hr_zone_${zoneIndex}_sec`
          const timeSeconds = findMetricTimeSeconds(metrics, metricName)

          return (
            <HrZoneBar
              key={zoneIndex}
              zoneIndex={zoneIndex}
              bpmRange={formatBpmRange(zoneIndex, thresholds)}
              timeSeconds={timeSeconds}
              targetMinutes={hrZoneWeeklyTargetMinutes[zoneIndex]}
              color={hrZoneColors[zoneIndex]}
            />
          )
        })}
      </div>
    </div>
  )
}
