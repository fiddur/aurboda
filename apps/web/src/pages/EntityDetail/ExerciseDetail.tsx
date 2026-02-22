/**
 * Exercise-specific detail view with HR chart and HR zone bar.
 */
import { format } from 'date-fns'
import { Activity } from '../../state/api'
import { ActivityChart } from './ActivityChart'

const formatTime = (d: Date) => format(d, 'HH:mm')
const formatDateTime = (d: Date) => format(d, 'yyyy-MM-dd HH:mm')

const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const hrZoneLabels = ['Rest', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5']
const hrZoneColors = ['#22c55e', '#22c55e', '#3b82f6', '#f59e0b', '#f97316', '#ef4444']

const HrZoneBar = ({ zones }: { zones: Record<number, number> }) => {
  const total = Object.values(zones).reduce((s, v) => s + v, 0)
  if (total <= 0) return null

  return (
    <div class="hr-zones-detail">
      <h3>HR Zones</h3>
      <div class="hr-zone-visual-bar">
        {[0, 1, 2, 3, 4, 5].map((z) => {
          const secs = zones[z] ?? 0
          const pct = (secs / total) * 100
          if (pct <= 0) return null
          return (
            <span
              key={z}
              class="hr-zone-segment"
              style={{ background: hrZoneColors[z], width: `${pct}%` }}
              title={`${hrZoneLabels[z]}: ${Math.round(secs / 60)}m`}
            />
          )
        })}
      </div>
      <div class="hr-zone-legend">
        {[0, 1, 2, 3, 4, 5].map((z) => {
          const secs = zones[z] ?? 0
          if (secs <= 0) return null
          return (
            <span key={z} class="hr-zone-entry">
              <span class="hr-zone-dot" style={{ background: hrZoneColors[z] }} />
              {hrZoneLabels[z]}: {Math.round(secs / 60)}m
            </span>
          )
        })}
      </div>
    </div>
  )
}

export const ExerciseDetail = ({ activity }: { activity: Activity }) => {
  const displayStart = activity.merged_start_time ?? activity.start_time
  const displayEnd =
    activity.merged_end_time ?? activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)
  const exerciseType = (activity.data as Record<string, unknown> | undefined)?.exerciseTypeName as
    | string
    | undefined

  return (
    <>
      <div class="entity-info">
        <div class="entity-meta">
          <span class="entity-type-badge">{activity.activity_type}</span>
          {activity.source && <span class="entity-source">Source: {activity.source}</span>}
        </div>

        <h2>{activity.title || exerciseType || 'Exercise'}</h2>

        <div class="entity-fields">
          <div class="field-row">
            <span class="field-label">Time</span>
            <span class="field-value">
              {formatDateTime(displayStart)} – {formatTime(displayEnd)}
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">Duration</span>
            <span class="field-value">{formatDuration(displayStart, displayEnd)}</span>
          </div>
          {activity.avg_hrv !== undefined && (
            <div class="field-row">
              <span class="field-label">Avg HRV</span>
              <span class="field-value">{activity.avg_hrv} ms</span>
            </div>
          )}
          {activity.notes && (
            <div class="field-row">
              <span class="field-label">Notes</span>
              <span class="field-value">{activity.notes}</span>
            </div>
          )}
        </div>

        {activity.hr_zone_secs && <HrZoneBar zones={activity.hr_zone_secs as Record<number, number>} />}
      </div>

      {/* HR chart with overlays */}
      <div class="detail-grid-full">
        <ActivityChart start={displayStart} end={displayEnd} showHrDefault={true} />
      </div>
    </>
  )
}
