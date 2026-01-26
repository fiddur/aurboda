import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'
import { fetchPeriodSummary, fetchUserSettings, HrZoneThresholds } from '../../state/api'
import { auth } from '../../state/auth'
import {
  defaultHrZoneThresholds,
  findMetricTimeSeconds,
  formatBpmRange,
  formatZoneTime,
  getWeekDateRange,
  hrZoneColors,
  hrZoneWeeklyTargetMinutes,
} from '../../utils/hrZones'

import './style.css'

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

const hrZoneMetrics = [
  'hr_zone_0_sec',
  'hr_zone_1_sec',
  'hr_zone_2_sec',
  'hr_zone_3_sec',
  'hr_zone_4_sec',
  'hr_zone_5_sec',
]

export function HrZones() {
  const isLoggedIn = auth.value.token

  // Memoize date range to prevent query key instability
  const dateRange = useMemo(() => getWeekDateRange(), [])

  const {
    data: periodSummary,
    isLoading: isLoadingSummary,
    error: summaryError,
  } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchPeriodSummary(new Date(dateRange.start), new Date(dateRange.end), hrZoneMetrics),
    queryKey: ['periodSummary', dateRange.start, dateRange.end],
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
    const errorMessage = summaryError instanceof Error ? summaryError.message : 'Unknown error'
    return (
      <div class="hr-zones-page">
        <h1>HR Zone Minutes</h1>
        <p class="error">Error loading data: {errorMessage}</p>
      </div>
    )
  }

  const thresholds: HrZoneThresholds = userSettings?.hr_zone_start ?? defaultHrZoneThresholds
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
