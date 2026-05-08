/**
 * Entity detail page — shows an activity, tag, productivity record, or metric data point
 * with notes and action buttons (delete / restore).
 *
 * Activity detail is data-driven: features are shown based on what data exists
 * (sleep stages, HR zones, exercise type) rather than hard-coded by display_category.
 */
import { exerciseTypeNames, getExerciseTypeName as getExerciseTypeNameFromValue } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useRoute } from 'preact-iso'
import { useCallback, useEffect, useState } from 'preact/hooks'

import type { Activity, ActivityTypeDefinition, ExerciseTypeName, SourceRecord } from '../../state/api'

import {
  fetchActivityById,
  fetchActivityTypeDefinitions,
  fetchBucketedMetrics,
  fetchItemIcons,
  fetchMetricTimeSeries,
  fetchProductivityById,
  fetchScreentimeCategories,
  resyncActivityDetail,
  softDeleteActivity,
  updateActivity,
} from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { ActivityChart } from './ActivityChart'
import { ActivityMap } from './ActivityMap'
import { type ActivityDraft, EditableActivityFields } from './EditableActivityFields'
import { EntityActions, type EntityType } from './EntityActions'
import { formatDateTimeLocal, formatTime } from './format-utils'
import { LocationInfo } from './LocationInfo'
import { MergePanel } from './MergePanel'
import { MetricContent } from './MetricContent'
import { MusicPlaylist } from './MusicPlaylist'
import { NotesSection } from './NotesSection'
import { ProductivityDetail } from './ProductivityDetail'
import { SchemaDataFields } from './SchemaDataFields'
import {
  computeSleepMinutesFromStages,
  formatMinutesAsHM,
  SLEEP_METRIC_LABELS,
  SLEEP_METRIC_UNITS,
  SLEEP_METRICS,
  type SleepMetricKey,
  parseSleepStages,
} from './sleep-utils'
import './style.css'

const SourceRecordsSection = ({ records }: { records: SourceRecord[] }) => (
  <div class="source-records">
    <h3>Sources ({records.length})</h3>
    {records.map((record) => (
      <a key={record.id} href={`/detail/activity/${record.id}`} class="source-record">
        <span class="source-record-source">
          {record.title ?? record.exercise_type_name ?? record.data_origin ?? record.source}
        </span>
        <span class="source-record-time">
          {formatTime(new Date(record.start_time))}
          {record.end_time ? ` – ${formatTime(new Date(record.end_time))}` : ''}
        </span>
        {record.title && record.data_origin && <span class="source-record-title">{record.data_origin}</span>}
      </a>
    ))}
  </div>
)

// ── Exercise helpers ──────────────────────────────────────────────────────────

const formatExerciseTypeName = (name: string): string => name.replaceAll('_', ' ')

/** Resolve exercise type name from activity data (supports both string name and numeric HC value). */
export const resolveExerciseType = (activity: Activity): string | undefined => {
  const data = activity.data as Record<string, unknown> | undefined
  return (
    (data?.exerciseTypeName as string | undefined) ??
    (typeof data?.exerciseType === 'number' ? getExerciseTypeNameFromValue(data.exerciseType) : undefined)
  )
}

// ── HR Zone Bar ───────────────────────────────────────────────────────────────

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

// ── Sleep Metrics ────────────────────────────────────────────────────────────

const extractSleepMetrics = (
  buckets: Array<{ metrics: Record<string, { avg: number }> }>,
): Partial<Record<SleepMetricKey, number>> => {
  const result: Partial<Record<SleepMetricKey, number>> = {}
  for (const bucket of buckets) {
    for (const [metric, stats] of Object.entries(bucket.metrics)) {
      if (SLEEP_METRICS.includes(metric as SleepMetricKey)) {
        result[metric as SleepMetricKey] = stats.avg
      }
    }
  }
  return result
}

const SleepMetricsCards = ({ metrics }: { metrics: Partial<Record<SleepMetricKey, number>> }) => (
  <div class="detail-section">
    <h3>Sleep Metrics</h3>
    <div class="metric-cards">
      {SLEEP_METRICS.map((key) => {
        const value = metrics[key]
        if (value === undefined) return null
        return (
          <div class="metric-card" key={key}>
            <div class="metric-card-label">{SLEEP_METRIC_LABELS[key]}</div>
            <div class="metric-card-value">
              {Math.round(value)}
              {SLEEP_METRIC_UNITS[key] && <span class="metric-card-unit">{SLEEP_METRIC_UNITS[key]}</span>}
            </div>
          </div>
        )
      })}
    </div>
  </div>
)

// ── Unified Activity Detail ──────────────────────────────────────────────────

/** Data-driven activity detail: shows features based on what data exists, not display_category. */
// eslint-disable-next-line complexity -- unified component replaces 3 separate ones
const ActivityDetailContent = ({
  activity,
  isEditing,
  draft,
  onDraftChange,
  itemIcons,
  typeDefinitions,
  referencedRules,
  onRevertOverride,
  isReverting,
}: {
  activity: Activity
  isEditing: boolean
  draft: ActivityDraft
  onDraftChange: (d: ActivityDraft) => void
  itemIcons: Record<string, string>
  typeDefinitions?: ActivityTypeDefinition[]
  referencedRules?: Record<string, string>
  onRevertOverride?: () => void
  isReverting?: boolean
}) => {
  const displayStart = activity.merged_start_time ?? activity.start_time
  const realEnd = activity.merged_end_time ?? activity.end_time
  const displayEnd = realEnd ?? new Date(activity.start_time.getTime() + 60 * 60000)
  const musicStart = displayStart
  const musicEnd = displayEnd
  const hasSourceRecords = activity.source_records && activity.source_records.length > 1

  // Resolve type info
  const exerciseType = resolveExerciseType(activity)
  const typeDef = typeDefinitions?.find((d) => d.name === activity.activity_type)
  const typeDisplayName = exerciseType
    ? formatExerciseTypeName(exerciseType)
    : (typeDef?.display_name ?? toDisplayName(activity.activity_type))

  // Resolve icon: exercise icon key → legacy exercise:{TypeName} → type def → activity icon
  const exerciseDisplayName = exerciseType ? formatExerciseTypeName(exerciseType) : undefined
  const exerciseIconKey = exerciseDisplayName ? `exercise:${exerciseDisplayName}` : undefined
  // For migrated exercise types (e.g., activity_type='yoga'), also try "exercise:Yoga"
  const formattedType = activity.activity_type
    .replaceAll('_', ' ')
    .replaceAll(/\b\w/g, (c) => c.toUpperCase())
  const icon =
    (exerciseIconKey && resolveItemIcon(exerciseIconKey, itemIcons)) ??
    resolveItemIcon(`exercise:${formattedType}`, itemIcons) ??
    typeDef?.icon ??
    resolveItemIcon(`activity:${activity.activity_type}`, itemIcons)

  // Data-driven: what exists on this activity?
  const stages = parseSleepStages(activity.data as Record<string, unknown> | undefined)
  const hasSleepStages = stages.length > 0
  const hrZoneSecs = activity.hr_zone_secs as Record<number, number> | undefined
  const hasHrZones = hrZoneSecs && Object.values(hrZoneSecs).some((v) => v > 0)
  const sleepMinutes =
    activity.total_sleep ?? (hasSleepStages ? computeSleepMinutesFromStages(stages) : undefined)
  const hasEndTime = Boolean(realEnd)
  const hasExerciseType = Boolean(exerciseType)
  const [hoverTime, setHoverTime] = useState<Date | null>(null)

  // Sleep metrics (only fetch when sleep stages exist)
  const endDateStr = hasSleepStages ? format(displayEnd, 'yyyy-MM-dd') : ''
  const sleepMetricsQuery = useQuery({
    enabled: hasSleepStages,
    queryFn: () => {
      const dayStart = new Date(`${endDateStr}T00:00:00`)
      const dayEnd = new Date(`${endDateStr}T23:59:59`)
      return fetchBucketedMetrics(dayStart, dayEnd, [...SLEEP_METRICS], '1d')
    },
    queryKey: ['detail-sleep-metrics', endDateStr],
    staleTime: 5 * 60 * 1000,
  })
  const sleepMetrics = hasSleepStages ? extractSleepMetrics(sleepMetricsQuery.data?.buckets ?? []) : {}
  const hasSleepMetrics = Object.keys(sleepMetrics).length > 0

  // Active calories (only fetch when exercise type exists)
  const caloriesQuery = useQuery({
    enabled: hasExerciseType && hasEndTime,
    queryFn: () => fetchMetricTimeSeries('calories_active', displayStart, displayEnd),
    queryKey: ['detail-calories', displayStart.toISOString(), displayEnd.toISOString()],
    staleTime: 5 * 60 * 1000,
  })
  const totalCalories =
    hasExerciseType && caloriesQuery.data && caloriesQuery.data.length > 0
      ? Math.round(caloriesQuery.data.reduce((sum, [, val]) => sum + val, 0))
      : undefined

  // Badge link: exercise sub-type or activity type
  const badgeHref = `/activity-type/${encodeURIComponent(exerciseType ?? activity.activity_type)}`

  return (
    <>
      {hasSourceRecords && (
        <div class="merged-indicator">Merged from {activity.source_records!.length} sources</div>
      )}
      {activity.overrides_id && (
        <div class="merged-indicator">
          User override active &mdash; edits to this activity stay even when the synced source re-syncs.
          {onRevertOverride && (
            <>
              {' '}
              <button type="button" class="link-button" onClick={onRevertOverride} disabled={isReverting}>
                Revert to source
              </button>
            </>
          )}
        </div>
      )}

      <div class="entity-info">
        <div class="entity-meta">
          <a href={badgeHref} class="entity-type-badge">
            {typeDisplayName}
          </a>
          {activity.source && <span class="entity-source">Source: {activity.source}</span>}
        </div>

        <EditableActivityFields
          title={activity.title || exerciseDisplayName || typeDisplayName}
          displayStart={displayStart}
          displayEnd={realEnd}
          notes={activity.notes}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
          icon={icon}
          durationLabel={hasSleepStages ? 'In Bed' : undefined}
        />

        {/* Exercise type selector (edit mode, when exercise type data exists) */}
        {isEditing && hasExerciseType && (
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

        {/* Schema data fields — editable in edit mode, read-only otherwise */}
        {typeDef?.data_schema && (isEditing || activity.data) && (
          <SchemaDataFields
            data={isEditing ? (draft.data ?? {}) : ((activity.data as Record<string, unknown>) ?? {})}
            schema={typeDef.data_schema}
            isEditing={isEditing}
            onDataChange={isEditing ? (newData) => onDraftChange({ ...draft, data: newData }) : undefined}
            referencedRules={referencedRules}
          />
        )}

        {/* Read-only stats — shown based on data presence, not activity type */}
        {!isEditing && (
          <>
            {hasExerciseType && (
              <div class="entity-fields">
                <div class="field-row">
                  <span class="field-label">Exercise Type</span>
                  <span class="field-value">
                    <a href={badgeHref} class="entity-meta-link">
                      {formatExerciseTypeName(exerciseType!)}
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
            {sleepMinutes !== undefined && (
              <div class="entity-fields">
                <div class="field-row">
                  <span class="field-label">Asleep</span>
                  <span class="field-value">{formatMinutesAsHM(sleepMinutes)}</span>
                </div>
              </div>
            )}
            {activity.avg_hrv !== undefined && (
              <div class="entity-fields">
                <div class="field-row">
                  <span class="field-label">Avg HRV</span>
                  <span class="field-value">{activity.avg_hrv} ms</span>
                </div>
              </div>
            )}
            {hasHrZones && <HrZoneBar zones={hrZoneSecs!} />}
          </>
        )}
      </div>

      {hasEndTime && !isEditing && <LocationInfo start={displayStart} end={displayEnd} />}

      {hasSleepMetrics && <SleepMetricsCards metrics={sleepMetrics} />}

      {hasEndTime && (
        <div class="detail-grid-full">
          <ActivityChart
            start={displayStart}
            end={displayEnd}
            stages={hasSleepStages ? stages : undefined}
            defaultMetrics={['heart_rate', 'hrv_rmssd']}
            onHoverTime={setHoverTime}
          />
          <ActivityMap start={displayStart} end={displayEnd} hoverTime={hoverTime} />
        </div>
      )}

      {hasSourceRecords && <SourceRecordsSection records={activity.source_records!} />}

      <div class="detail-grid">
        <MusicPlaylist start={musicStart} end={musicEnd} />
      </div>
    </>
  )
}

const makeDraft = (activity: Activity): ActivityDraft => {
  const displayStart = activity.merged_start_time ?? activity.start_time
  const displayEnd = activity.merged_end_time ?? activity.end_time
  const exerciseType = resolveExerciseType(activity)
  return {
    activity_type: activity.activity_type,
    data: (activity.data as Record<string, unknown>) ?? {},
    end_time: displayEnd ? formatDateTimeLocal(displayEnd) : '',
    exercise_type: exerciseType,
    notes: activity.notes ?? '',
    start_time: formatDateTimeLocal(displayStart),
    title: activity.title ?? '',
  }
}

/** Activity entity content with edit/save logic. */
const ResyncDetailButton = ({
  activity,
  activityId,
  onSuccess,
  isEditing,
}: {
  activity: Activity
  activityId: string
  onSuccess: () => void
  isEditing: boolean
}) => {
  const mutation = useMutation({
    mutationFn: () => resyncActivityDetail(activityId),
    onSuccess,
  })

  const hasGarminId = Boolean((activity.data as Record<string, unknown> | undefined)?.garmin_activity_id)
  if (!hasGarminId || isEditing) return null

  return (
    <div class="entity-actions">
      <button
        type="button"
        class="btn-secondary"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Re-syncing...' : 'Re-sync Garmin Detail'}
      </button>
      {mutation.isSuccess && <span class="sync-result done">Synced {mutation.data.points} data points</span>}
      {mutation.isError && (
        <span class="sync-result error">
          {mutation.error instanceof Error ? mutation.error.message : 'Re-sync failed'}
        </span>
      )}
    </div>
  )
}

const ActivityContent = ({ entityId }: { entityId: string }) => {
  const queryClient = useQueryClient()
  const isMerged = entityId.startsWith('merged:')
  const rawEntityId = isMerged ? entityId.slice('merged:'.length) : entityId

  const {
    data: activityResult,
    isLoading,
    isError,
  } = useQuery({
    queryFn: () => fetchActivityById(entityId),
    queryKey: ['entity-detail', 'activity', entityId],
    staleTime: 60_000,
  })
  const activity = activityResult?.activity
  const referencedRules = activityResult?.referenced_rules

  const { data: itemIcons = {} } = useQuery({
    queryFn: fetchItemIcons,
    queryKey: ['item-icons'],
    staleTime: 30 * 60 * 1000,
  })

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ['entity-detail', 'activity', entityId],
      }),
    [queryClient, entityId],
  )

  // Invalidate timeline queries when leaving so parent views show fresh data
  useEffect(
    () => () =>
      void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('timeline-') }),
    [queryClient],
  )

  const { data: typeDefinitions } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 30 * 60 * 1000,
  })

  const [isEditing, setIsEditing] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const emptyDraft: ActivityDraft = {
    activity_type: '',
    data: {},
    end_time: '',
    notes: '',
    start_time: '',
    title: '',
  }
  const [draft, setDraft] = useState<ActivityDraft>(emptyDraft)

  const isMergedActivity = Boolean(activity?.source_records && activity.source_records.length > 1)

  const startEditing = useCallback(() => {
    if (!activity) return
    setDraft(makeDraft(activity))
    setIsEditing(true)
  }, [activity])

  const revertOverrideMutation = useMutation({
    mutationFn: () => {
      if (!activity?.id) return Promise.resolve()
      return softDeleteActivity(activity.id)
    },
    onSuccess: () => invalidate(),
  })

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!activity) return Promise.resolve()
      const body: {
        activity_type?: string
        start_time?: string
        end_time?: string | null
        title?: string
        notes?: string
        exercise_type?: ExerciseTypeName
        data?: Record<string, unknown>
      } = {}
      const orig = makeDraft(activity)
      if (draft.activity_type !== orig.activity_type) body.activity_type = draft.activity_type
      if (draft.title !== orig.title) body.title = draft.title
      if (draft.start_time !== orig.start_time) {
        body.start_time = new Date(draft.start_time).toISOString()
      }
      if (draft.end_time !== orig.end_time) {
        body.end_time = draft.end_time ? new Date(draft.end_time).toISOString() : null
      }
      if (draft.notes !== orig.notes) body.notes = draft.notes
      if (draft.exercise_type !== orig.exercise_type && draft.exercise_type) {
        body.exercise_type = draft.exercise_type as ExerciseTypeName
      }
      if (draft.data && JSON.stringify(draft.data) !== JSON.stringify(orig.data)) {
        body.data = draft.data
      }
      if (Object.keys(body).length === 0) return Promise.resolve()
      return updateActivity(rawEntityId, body)
    },
    onSuccess: () => {
      setIsEditing(false)
      invalidate()
    },
  })

  if (isLoading) return <p class="loading">Loading...</p>
  if (isError || !activity) return <p class="error">Failed to load activity</p>

  const allEntityIds = activity.source_records ? activity.source_records.map((r) => r.id) : undefined

  return (
    <>
      <EntityActions
        entityType="activity"
        entityId={rawEntityId}
        isDeleted={Boolean(activity.deleted_at)}
        onMutationSuccess={invalidate}
        canEdit={true}
        isMerged={isMergedActivity}
        isEditing={isEditing}
        onStartEditing={startEditing}
        onCancelEditing={() => {
          setIsEditing(false)
          setDraft(emptyDraft)
        }}
        onSave={() => saveMutation.mutate()}
        isSaving={saveMutation.isPending}
        onStartMerging={!activity.deleted_at && !isMergedActivity ? () => setIsMerging(true) : undefined}
      />
      <ResyncDetailButton
        activity={activity}
        activityId={rawEntityId}
        onSuccess={() => queryClient.invalidateQueries()}
        isEditing={isEditing}
      />
      {isMerging && <MergePanel activityId={rawEntityId} onCancel={() => setIsMerging(false)} />}
      <ActivityDetailContent
        activity={activity}
        isEditing={isEditing}
        draft={draft}
        onDraftChange={setDraft}
        itemIcons={itemIcons}
        typeDefinitions={typeDefinitions}
        referencedRules={referencedRules}
        onRevertOverride={() => revertOverrideMutation.mutate()}
        isReverting={revertOverrideMutation.isPending}
      />
      <NotesSection entityType="activity" entityId={rawEntityId} allEntityIds={allEntityIds} />
    </>
  )
}

/** Productivity entity content. */
const ProductivityContent = ({ entityId }: { entityId: string }) => {
  const queryClient = useQueryClient()
  const {
    data: record,
    isLoading,
    isError,
  } = useQuery({
    queryFn: () => fetchProductivityById(entityId),
    queryKey: ['entity-detail', 'productivity', entityId],
    staleTime: 60_000,
  })

  const { data: categories = [] } = useQuery({
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 5 * 60 * 1000,
  })

  const { data: itemIcons = {} } = useQuery({
    queryFn: fetchItemIcons,
    queryKey: ['item-icons'],
    staleTime: 30 * 60 * 1000,
  })

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: ['entity-detail', 'productivity', entityId],
      }),
    [queryClient, entityId],
  )

  if (isLoading) return <p class="loading">Loading...</p>
  if (isError || !record) {
    return <p class="error">Failed to load productivity record</p>
  }

  const allEntityIds = record.source_ids

  return (
    <>
      <EntityActions
        entityType="productivity"
        entityId={entityId}
        isDeleted={false}
        onMutationSuccess={invalidate}
        canEdit={false}
        isMerged={false}
        isEditing={false}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSave={() => {}}
        isSaving={false}
      />
      <ProductivityDetail record={record} categories={categories} itemIcons={itemIcons} />
      <LocationInfo start={record.start_time} end={record.end_time} />
      <NotesSection entityType="productivity" entityId={entityId} allEntityIds={allEntityIds} />
    </>
  )
}

const VALID_ENTITY_TYPES = new Set<string>(['activity', 'productivity', 'metric'])

export const EntityDetail = () => {
  const { params } = useRoute()
  const rawEntityType = params.type as string
  const entityId = decodeURIComponent(params.id as string)

  // Tags are now activities — redirect tag routes to activity
  const entityType: EntityType = rawEntityType === 'tag' ? 'activity' : (rawEntityType as EntityType)

  if (!VALID_ENTITY_TYPES.has(entityType) && rawEntityType !== 'tag') {
    return (
      <div class="entity-detail-page">
        <p class="error">Unknown entity type: {rawEntityType}</p>
      </div>
    )
  }

  return (
    <div class="entity-detail-page">
      {entityType === 'activity' && <ActivityContent entityId={entityId} />}
      {entityType === 'productivity' && <ProductivityContent entityId={entityId} />}
      {entityType === 'metric' && <MetricContent entityId={entityId} />}
    </div>
  )
}
