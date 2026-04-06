/**
 * Exercise-specific detail view with HR chart and HR zone bar.
 */
import { exerciseTypeNames, getExerciseTypeName } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import type { Activity, ActivityTypeDefinition } from '../../state/api'

import { fetchMetricTimeSeries } from '../../state/api'
import { resolveItemIcon } from '../../utils/emojiLookup'
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

/** Resolve exercise type name from activity data (supports both string name and numeric HC value). */
export const resolveExerciseType = (activity: Activity): string | undefined => {
  const data = activity.data as Record<string, unknown> | undefined
  return (
    (data?.exerciseTypeName as string | undefined) ??
    (typeof data?.exerciseType === 'number' ? getExerciseTypeName(data.exerciseType) : undefined)
  )
}

/** Resolve exercise icon from item_icons based on activity data. */
const resolveExerciseIcon = (
  activity: Activity,
  itemIcons: Record<string, string>,
): { exerciseType: string | undefined; displayName: string | undefined; icon: string | undefined } => {
  const exerciseType = resolveExerciseType(activity)
  const displayName = exerciseType ? formatExerciseTypeName(exerciseType) : undefined
  const iconKey = displayName ? `exercise:${displayName}` : 'activity:exercise'
  const icon = resolveItemIcon(iconKey, itemIcons)
  return { displayName, exerciseType, icon }
}

/** Exercise type selector for edit mode. */
const ExerciseTypeSelect = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
  <div class="entity-fields" style={{ marginTop: '0.5rem' }}>
    <div class="field-row">
      <span class="field-label">Exercise Type</span>
      <span class="field-value">
        <select
          class="edit-datetime-input"
          value={value}
          onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
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
)

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
          <span class="field-value">
            <a href={`/exercise/${encodeURIComponent(exerciseType)}`} class="entity-meta-link">
              {formatExerciseTypeName(exerciseType)}
            </a>
          </span>
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
  itemIcons,
  typeDefinitions,
}: {
  activity: Activity
  isEditing: boolean
  draft: ActivityDraft
  onDraftChange: (d: ActivityDraft) => void
  itemIcons: Record<string, string>
  typeDefinitions?: ActivityTypeDefinition[]
}) => {
  const displayStart = activity.merged_start_time ?? activity.start_time
  const displayEnd =
    activity.merged_end_time ?? activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)
  const { exerciseType, displayName, icon } = resolveExerciseIcon(activity, itemIcons)

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
          {exerciseType ? (
            <a href={`/exercise/${encodeURIComponent(exerciseType)}`} class="entity-type-badge">
              {formatExerciseTypeName(exerciseType)}
            </a>
          ) : (
            <span class="entity-type-badge">{activity.activity_type}</span>
          )}
          {activity.source && <span class="entity-source">Source: {activity.source}</span>}
        </div>

        <EditableActivityFields
          title={activity.title || (displayName ?? 'Exercise')}
          displayStart={displayStart}
          displayEnd={displayEnd}
          notes={activity.notes}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
          typeDefinitions={typeDefinitions}
          icon={icon}
        />

        {isEditing && (
          <ExerciseTypeSelect
            value={draft.exercise_type ?? exerciseType ?? ''}
            onChange={(value) => onDraftChange({ ...draft, exercise_type: value })}
          />
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
        <ActivityChart start={displayStart} end={displayEnd} defaultMetrics={['heart_rate', 'hrv_rmssd']} />
      </div>
    </>
  )
}
