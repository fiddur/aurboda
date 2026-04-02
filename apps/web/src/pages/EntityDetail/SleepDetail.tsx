/**
 * Sleep-specific detail view with Oura metrics, hypnogram chart, and time breakdowns.
 */
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

import type { Activity } from '../../state/api'

import { fetchBucketedMetrics } from '../../state/api'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { ActivityChart } from './ActivityChart'
import { type ActivityDraft, EditableActivityFields } from './EditableActivityFields'
import {
  computeSleepMinutesFromStages,
  formatMinutesAsHM,
  OURA_METRIC_LABELS,
  OURA_METRIC_UNITS,
  OURA_SLEEP_METRICS,
  type OuraSleepMetricKey,
  parseSleepStages,
} from './sleep-utils'

/** Extract Oura metric values from bucketed query response. */
const extractOuraMetrics = (
  buckets: Array<{ metrics: Record<string, { avg: number }> }>,
): Partial<Record<OuraSleepMetricKey, number>> => {
  const result: Partial<Record<OuraSleepMetricKey, number>> = {}
  for (const bucket of buckets) {
    for (const [metric, stats] of Object.entries(bucket.metrics)) {
      if (OURA_SLEEP_METRICS.includes(metric as OuraSleepMetricKey)) {
        result[metric as OuraSleepMetricKey] = stats.avg
      }
    }
  }
  return result
}

/** Resolve actual sleep minutes from total_sleep field or computed from stages. */
const resolveSleepMinutes = (
  totalSleep: number | undefined,
  stages: ReturnType<typeof parseSleepStages>,
): number | undefined => {
  if (totalSleep !== undefined) return totalSleep
  if (stages.length > 0) return computeSleepMinutesFromStages(stages)
  return undefined
}

const OuraMetricsCards = ({ metrics }: { metrics: Partial<Record<OuraSleepMetricKey, number>> }) => (
  <div class="detail-section">
    <h3>Oura Sleep Metrics</h3>
    <div class="metric-cards">
      {OURA_SLEEP_METRICS.map((key) => {
        const value = metrics[key]
        if (value === undefined) return null
        return (
          <div class="metric-card" key={key}>
            <div class="metric-card-label">{OURA_METRIC_LABELS[key]}</div>
            <div class="metric-card-value">
              {Math.round(value)}
              {OURA_METRIC_UNITS[key] && <span class="metric-card-unit">{OURA_METRIC_UNITS[key]}</span>}
            </div>
          </div>
        )
      })}
    </div>
  </div>
)

export const SleepDetail = ({
  activity,
  isEditing,
  draft,
  onDraftChange,
  itemIcons,
}: {
  activity: Activity
  isEditing: boolean
  draft: ActivityDraft
  onDraftChange: (d: ActivityDraft) => void
  itemIcons: Record<string, string>
}) => {
  const end = activity.end_time ?? new Date(activity.start_time.getTime() + 8 * 60 * 60000)
  const displayStart = activity.merged_start_time ?? activity.start_time
  const displayEnd = activity.merged_end_time ?? end
  const icon = resolveItemIcon(`activity:${activity.activity_type}`, itemIcons)
  const stages = parseSleepStages(activity.data as Record<string, unknown> | undefined)
  const sleepMinutes = resolveSleepMinutes(activity.total_sleep, stages)

  const endDateStr = format(displayEnd, 'yyyy-MM-dd')
  const ouraQuery = useQuery({
    queryFn: () => {
      const dayStart = new Date(`${endDateStr}T00:00:00`)
      const dayEnd = new Date(`${endDateStr}T23:59:59`)
      return fetchBucketedMetrics(dayStart, dayEnd, [...OURA_SLEEP_METRICS], '1d')
    },
    queryKey: ['detail-oura-sleep', endDateStr],
    staleTime: 5 * 60 * 1000,
  })

  const ouraMetrics = extractOuraMetrics(ouraQuery.data?.buckets ?? [])
  const hasOuraMetrics = Object.keys(ouraMetrics).length > 0

  return (
    <>
      <div class="entity-info">
        <div class="entity-meta">
          <span class="entity-type-badge">{activity.activity_type}</span>
          {activity.source && <span class="entity-source">Source: {activity.source}</span>}
        </div>

        <EditableActivityFields
          title={activity.title || (activity.activity_type === 'nap' ? 'Nap' : 'Sleep')}
          displayStart={displayStart}
          displayEnd={displayEnd}
          notes={activity.notes}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
          durationLabel="In Bed"
          icon={icon}
        />

        {!isEditing && (
          <div class="entity-fields">
            {sleepMinutes !== undefined && (
              <div class="field-row">
                <span class="field-label">Asleep</span>
                <span class="field-value">{formatMinutesAsHM(sleepMinutes)}</span>
              </div>
            )}
            {activity.avg_hrv !== undefined && (
              <div class="field-row">
                <span class="field-label">Avg HRV</span>
                <span class="field-value">{activity.avg_hrv} ms</span>
              </div>
            )}
          </div>
        )}
      </div>

      {hasOuraMetrics && <OuraMetricsCards metrics={ouraMetrics} />}

      <div class="detail-grid-full">
        <ActivityChart
          start={displayStart}
          end={displayEnd}
          stages={stages.length > 0 ? stages : undefined}
          defaultMetrics={['heart_rate', 'hrv_rmssd']}
        />
      </div>
    </>
  )
}
