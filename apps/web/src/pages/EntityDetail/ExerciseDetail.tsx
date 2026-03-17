/**
 * Exercise-specific detail view with HR chart and HR zone bar.
 */
import { exerciseTypeNames } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import type { Activity } from '../../state/api'

import { fetchMetricTimeSeries } from '../../state/api'
import { ActivityChart } from './ActivityChart'
import { type ActivityDraft, EditableActivityFields } from './EditableActivityFields'

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

const formatExerciseTypeName = (name: string): string => name.replaceAll('_', ' ')

/** Read-only display of exercise stats (type, calories, HRV, HR zones). */
const ExerciseStats = ({
  exerciseType,
  totalCalories,
  avgHrv,
  hrZoneSecs,
}: {
  exerciseType?: string
  totalCalories?: number
  avgHrv?: number
  hrZoneSecs?: Record<string, unknown>
}) => (
  <>
    {exerciseType && (
      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Exercise Type</span>
          <span class="field-value">{formatExerciseTypeName(exerciseType)}</span>
        </div>
      </div>
    )}
    {totalCalories !== undefined && (
      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Active Calories</span>
          <span class="field-value">{totalCalories} kcal</span>
        </div>
      </div>
    )}
    {avgHrv !== undefined && (
      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Avg HRV</span>
          <span class="field-value">{avgHrv} ms</span>
        </div>
      </div>
    )}
    {hrZoneSecs && <HrZoneBar zones={hrZoneSecs as Record<number, number>} />}
  </>
)

export const ExerciseDetail = ({
  activity,
  isEditing,
  draft,
  onDraftChange,
}: {
  activity: Activity
  isEditing: boolean
  draft: ActivityDraft
  onDraftChange: (d: ActivityDraft) => void
}) => {
  const displayStart = activity.merged_start_time ?? activity.start_time
  const displayEnd =
    activity.merged_end_time ?? activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)
  const exerciseType = (activity.data as Record<string, unknown> | undefined)?.exerciseTypeName as
    | string
    | undefined

  const caloriesQuery = useQuery({
    queryFn: () => fetchMetricTimeSeries('calories_active', displayStart, displayEnd),
    queryKey: ['detail-calories', displayStart.toISOString(), displayEnd.toISOString()],
    staleTime: 5 * 60 * 1000,
  })

  const totalCalories =
    caloriesQuery.data && caloriesQuery.data.length > 0
      ? Math.round(caloriesQuery.data.reduce((sum, [, val]) => sum + val, 0))
      : undefined

  return (
    <>
      <div class="entity-info">
        <div class="entity-meta">
          <span class="entity-type-badge">{activity.activity_type}</span>
          {activity.source && <span class="entity-source">Source: {activity.source}</span>}
        </div>

        <EditableActivityFields
          title={activity.title || exerciseType || 'Exercise'}
          displayStart={displayStart}
          displayEnd={displayEnd}
          notes={activity.notes}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
        />

        {isEditing && (
          <div class="entity-fields" style={{ marginTop: '0.5rem' }}>
            <div class="field-row">
              <span class="field-label">Exercise Type</span>
              <span class="field-value">
                <select
                  class="edit-datetime-input"
                  value={draft.exercise_type ?? exerciseType ?? ''}
                  onChange={(e) =>
                    onDraftChange({ ...draft, exercise_type: (e.target as HTMLSelectElement).value })
                  }
                >
                  <option value="">-- Select --</option>
                  {exerciseTypeNames.map((name) => (
                    <option key={name} value={name}>
                      {formatExerciseTypeName(name)}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          </div>
        )}

        {!isEditing && (
          <ExerciseStats
            exerciseType={exerciseType}
            totalCalories={totalCalories}
            avgHrv={activity.avg_hrv}
            hrZoneSecs={activity.hr_zone_secs as Record<string, unknown> | undefined}
          />
        )}
      </div>

      {/* HR chart with overlays */}
      <div class="detail-grid-full">
        <ActivityChart start={displayStart} end={displayEnd} showHrDefault={true} showHrvDefault={true} />
      </div>
    </>
  )
}
