/**
 * HrZonesWidget - Compact HR zone progress bars for the dashboard.
 */

import type { HrZonesConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import type { HrZoneThresholds } from '../../state/api'

import { fetchPeriodSummary, fetchUserSettings } from '../../state/api'
import { auth } from '../../state/auth'
import {
  defaultHrZoneThresholds,
  findMetricTimeSeconds,
  formatBpmRange,
  formatZoneTime,
  hrZoneColors,
  hrZoneWeeklyTargetMinutes,
} from '../../utils/hrZones'

interface HrZonesWidgetProps {
  config: HrZonesConfig
}

const hrZoneMetrics = [
  'hr_zone_0_sec',
  'hr_zone_1_sec',
  'hr_zone_2_sec',
  'hr_zone_3_sec',
  'hr_zone_4_sec',
  'hr_zone_5_sec',
]

const zoneIndices = [0, 1, 2, 3, 4, 5]

function getDateRange(lookbackDays: number): { start: string; end: string } {
  const today = new Date()
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - (lookbackDays - 1))
  startDate.setHours(0, 0, 0, 0)
  return { end: endDate.toISOString(), start: startDate.toISOString() }
}

export function HrZonesWidget({ config }: HrZonesWidgetProps) {
  const { lookback_days = 7, show_targets = true } = config
  const isLoggedIn = auth.value.token

  const dateRange = useMemo(() => getDateRange(lookback_days), [lookback_days])

  const { data: periodSummary, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchPeriodSummary(new Date(dateRange.start), new Date(dateRange.end), hrZoneMetrics),
    queryKey: ['periodSummary', dateRange.start, dateRange.end],
    staleTime: 5 * 60 * 1000,
  })

  const { data: userSettings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div class="hr-zones-widget">
        <h3>HR Zones (Last {lookback_days} Days)</h3>
        <div class="hr-zones-widget-loading">Loading...</div>
      </div>
    )
  }

  const thresholds: HrZoneThresholds = userSettings?.hr_zone_start ?? defaultHrZoneThresholds
  const metrics = periodSummary?.metrics ?? []

  return (
    <div class="hr-zones-widget">
      <h3>HR Zones (Last {lookback_days} Days)</h3>
      <div class="hr-zones-widget-list">
        {zoneIndices.map((zoneIndex) => {
          const timeSeconds = findMetricTimeSeconds(metrics, `hr_zone_${zoneIndex}_sec`)
          const targetMinutes = hrZoneWeeklyTargetMinutes[zoneIndex]
          const progress = targetMinutes > 0 ? Math.min((timeSeconds / 60 / targetMinutes) * 100, 100) : 0
          const color = hrZoneColors[zoneIndex]

          return (
            <div key={zoneIndex} class="hr-zones-widget-bar">
              <div class="hr-zones-widget-header">
                <span class="hr-zones-widget-label">
                  Z{zoneIndex} ({formatBpmRange(zoneIndex, thresholds)})
                </span>
                <span class="hr-zones-widget-time">{formatZoneTime(timeSeconds)}</span>
              </div>
              <div class="hr-zones-widget-progress-row">
                <div class="hr-zones-widget-track" style={{ backgroundColor: `${color}33` }}>
                  <div
                    class="hr-zones-widget-fill"
                    style={{ backgroundColor: color, width: `${progress}%` }}
                  />
                </div>
                {show_targets && targetMinutes > 0 && (
                  <span class="hr-zones-widget-percent">{Math.round(progress)}%</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
