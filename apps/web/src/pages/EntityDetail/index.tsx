/**
 * Entity detail page — shows an activity, tag, productivity record, or metric data point
 * with notes and action buttons (delete / restore).
 *
 * Activities dispatch to type-specific detail components:
 * - sleep/nap → SleepDetail (hypnogram, Oura metrics, HR/HRV)
 * - exercise  → ExerciseDetail (HR chart, HR zones)
 * - other     → generic ActivityDetail (HR/HRV chart)
 */
import { metricUnits as builtinMetricUnits } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'
import {
  Activity,
  deleteMetricPoint,
  type ExerciseTypeName,
  fetchActivityById,
  fetchCustomMetrics,
  fetchMetricTimeSeriesWithSource,
  fetchProductivity,
  fetchTagById,
  type MetricDataPointWithSource,
  type ProductivityRecord,
  restoreActivity,
  restoreProductivity,
  restoreTag,
  softDeleteActivity,
  softDeleteProductivity,
  softDeleteTag,
  SourceRecord,
  Tag,
  updateActivity,
} from '../../state/api'
import { ActivityChart } from './ActivityChart'
import { type ActivityDraft, EditableActivityFields } from './EditableActivityFields'
import { ExerciseDetail } from './ExerciseDetail'
import { formatDateTime, formatDateTimeLocal, formatDuration, formatTime } from './format-utils'
import { MusicPlaylist } from './MusicPlaylist'
import { NotesSection } from './NotesSection'
import { SleepDetail } from './SleepDetail'

import './style.css'

type EntityType = 'activity' | 'tag' | 'productivity' | 'metric'

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

/** Generic activity detail for types other than sleep/exercise. */
const GenericActivityDetail = ({
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

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">{activity.activity_type}</span>
        {activity.source && <span class="entity-source">Source: {activity.source}</span>}
      </div>

      <EditableActivityFields
        title={activity.title || exerciseType || activity.activity_type}
        displayStart={displayStart}
        displayEnd={displayEnd}
        notes={activity.notes}
        isEditing={isEditing}
        draft={draft}
        onDraftChange={onDraftChange}
      />

      {!isEditing && activity.avg_hrv !== undefined && (
        <div class="entity-fields">
          <div class="field-row">
            <span class="field-label">Avg HRV</span>
            <span class="field-value">{activity.avg_hrv} ms</span>
          </div>
        </div>
      )}

      <ActivityChart start={displayStart} end={displayEnd} showHrDefault={true} showHrvDefault={true} />
    </div>
  )
}

/** Dispatch to type-specific activity detail component. */
const ActivityDetailDispatch = ({
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
  const musicStart = activity.merged_start_time ?? activity.start_time
  const musicEnd =
    activity.merged_end_time ?? activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)

  const isSleep = activity.activity_type === 'sleep' || activity.activity_type === 'nap'
  const isExercise = activity.activity_type === 'exercise'
  const hasSourceRecords = activity.source_records && activity.source_records.length > 1

  return (
    <>
      {hasSourceRecords && (
        <div class="merged-indicator">Merged from {activity.source_records!.length} sources</div>
      )}

      {isSleep && (
        <SleepDetail activity={activity} isEditing={isEditing} draft={draft} onDraftChange={onDraftChange} />
      )}
      {isExercise && (
        <ExerciseDetail
          activity={activity}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
        />
      )}
      {!isSleep && !isExercise && (
        <GenericActivityDetail
          activity={activity}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
        />
      )}

      {hasSourceRecords && <SourceRecordsSection records={activity.source_records!} />}

      <div class="detail-grid">
        <MusicPlaylist start={musicStart} end={musicEnd} />
      </div>
    </>
  )
}

const TagDetail = ({ tag }: { tag: Tag }) => {
  const end = tag.end_time
  const isPoint = !end

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">tag</span>
        {tag.source && <span class="entity-source">Source: {tag.source}</span>}
      </div>

      <h2>{tag.tag}</h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">
            {isPoint ?
              formatDateTime(tag.start_time)
            : `${formatDateTime(tag.start_time)} – ${formatTime(end!)}`}
          </span>
        </div>
        {!isPoint && (
          <div class="field-row">
            <span class="field-label">Duration</span>
            <span class="field-value">{formatDuration(tag.start_time, end!)}</span>
          </div>
        )}
        {isPoint && (
          <div class="field-row">
            <span class="field-label">Type</span>
            <span class="field-value">Point event</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Parse a metric entity ID (format: "iso_time|metric_name|source"). */
const parseMetricEntityId = (entityId: string): { time: string; metric: string; source: string } | null => {
  const parts = entityId.split('|')
  if (parts.length !== 3) return null
  const [time, metric, source] = parts
  if (!time || !metric || !source) return null
  const d = new Date(time)
  if (isNaN(d.getTime())) return null
  return { metric, source, time }
}

/** Map metric name to human-readable display label. */
const formatMetricLabel = (metric: string): string =>
  metric.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const MetricDetail = ({ entityId }: { entityId: string }) => {
  const parsed = parseMetricEntityId(entityId)

  // Look up the data point to get current value (in case it was updated)
  const customMetricsQuery = useQuery({
    queryFn: fetchCustomMetrics,
    queryKey: ['custom-metrics'],
    staleTime: 30 * 60 * 1000,
  })

  const pointQuery = useQuery({
    enabled: parsed !== null,
    queryFn: async (): Promise<MetricDataPointWithSource | null> => {
      if (!parsed) return null
      const time = new Date(parsed.time)
      // Narrow query: 1 second window around the exact time
      const start = new Date(time.getTime() - 500)
      const end = new Date(time.getTime() + 500)
      const points = await fetchMetricTimeSeriesWithSource(parsed.metric, start, end)
      // Find exact match by source
      return points.find((p) => p.source === parsed.source) ?? points[0] ?? null
    },
    queryKey: ['metric-point', entityId],
    staleTime: 60_000,
  })

  if (!parsed) {
    return <p class="error">Invalid metric reference</p>
  }

  const metricLabel = formatMetricLabel(parsed.metric)
  const customUnit = customMetricsQuery.data?.find((m) => m.name === parsed.metric)?.unit
  const unit = customUnit ?? (builtinMetricUnits as Record<string, string>)[parsed.metric] ?? ''
  const point = pointQuery.data
  const time = new Date(parsed.time)
  const displayValue = point ? Number(point.value.toFixed(2)) : null

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">metric</span>
        <span class="entity-source">Source: {parsed.source}</span>
      </div>

      <h2>{metricLabel}</h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">{formatDateTime(time)}</span>
        </div>
        <div class="field-row">
          <span class="field-label">Value</span>
          <span class="field-value">
            {pointQuery.isLoading ?
              'Loading...'
            : displayValue !== null ?
              `${displayValue}${unit ? ` ${unit}` : ''}`
            : 'Not found'}
          </span>
        </div>
        <div class="field-row">
          <span class="field-label">Metric</span>
          <span class="field-value">{parsed.metric}</span>
        </div>
      </div>
    </div>
  )
}

const productivityScoreLabel = (score: number | undefined | null): string => {
  switch (score) {
    case 2:
      return 'Very Productive'
    case 1:
      return 'Productive'
    case 0:
      return 'Neutral'
    case -1:
      return 'Distracting'
    case -2:
      return 'Very Distracting'
    default:
      return 'Uncategorized'
  }
}

const ProductivityDetail = ({ record }: { record: ProductivityRecord }) => (
  <div class="entity-info">
    <div class="entity-meta">
      <span class="entity-type-badge">screen time</span>
      {record.is_mobile && <span class="entity-source">Mobile</span>}
    </div>

    <h2>{record.activity}</h2>

    <div class="entity-fields">
      <div class="field-row">
        <span class="field-label">Time</span>
        <span class="field-value">
          {formatTime(record.start_time)} – {formatTime(record.end_time)}
        </span>
      </div>
      <div class="field-row">
        <span class="field-label">Duration</span>
        <span class="field-value">{formatDuration(record.start_time, record.end_time)}</span>
      </div>
      {record.category && (
        <div class="field-row">
          <span class="field-label">Category</span>
          <span class="field-value">{record.category}</span>
        </div>
      )}
      <div class="field-row">
        <span class="field-label">Productivity</span>
        <span class="field-value">{productivityScoreLabel(record.productivity)}</span>
      </div>
      {record.source_ids && record.source_ids.length > 1 && (
        <div class="field-row">
          <span class="field-label">Merged spans</span>
          <span class="field-value">{record.source_ids.length}</span>
        </div>
      )}
    </div>
  </div>
)

const deleteEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity') return softDeleteActivity(entityId)
  if (entityType === 'tag') return softDeleteTag(entityId)
  if (entityType === 'productivity') return softDeleteProductivity(entityId)
  if (entityType === 'metric') {
    const parsed = parseMetricEntityId(entityId)
    if (!parsed) return Promise.reject(new Error('Invalid metric entity ID'))
    return deleteMetricPoint(parsed.metric, parsed.time)
  }
  return Promise.reject(new Error('Unsupported entity type for delete'))
}

const restoreEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity') return restoreActivity(entityId)
  if (entityType === 'tag') return restoreTag(entityId)
  if (entityType === 'productivity') return restoreProductivity(entityId)
  return Promise.reject(new Error('Unsupported entity type for restore'))
}

const PencilIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

const EntityActions = ({
  entityType,
  entityId,
  isDeleted,
  onMutationSuccess,
  canEdit,
  isMerged,
  isEditing,
  onStartEditing,
  onCancelEditing,
  onSave,
  isSaving,
}: {
  entityType: EntityType
  entityId: string
  isDeleted: boolean
  onMutationSuccess: () => void
  canEdit: boolean
  isMerged: boolean
  isEditing: boolean
  onStartEditing: () => void
  onCancelEditing: () => void
  onSave: () => void
  isSaving: boolean
}) => {
  const deleteMutation = useMutation({
    mutationFn: () => deleteEntity(entityType, entityId),
    onSuccess: onMutationSuccess,
  })

  const restoreMutation = useMutation({
    mutationFn: () => restoreEntity(entityType, entityId),
    onSuccess: onMutationSuccess,
  })

  if (isDeleted) {
    return (
      <div class="deleted-banner">
        This {entityType} has been deleted.
        <button
          class="btn-restore"
          onClick={() => restoreMutation.mutate()}
          disabled={restoreMutation.isPending}
          type="button"
        >
          {restoreMutation.isPending ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    )
  }

  return (
    <div class="entity-actions">
      {canEdit && !isEditing && (
        <button
          class="btn-edit"
          onClick={onStartEditing}
          disabled={isMerged}
          title={isMerged ? 'Edit individual sources' : 'Edit activity'}
          type="button"
        >
          <PencilIcon />
        </button>
      )}
      {isEditing && (
        <>
          <button class="btn-primary" onClick={onSave} disabled={isSaving} type="button">
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button class="btn-secondary" onClick={onCancelEditing} type="button">
            Cancel
          </button>
        </>
      )}
      {!isEditing && (
        <button
          class="btn-danger"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          type="button"
        >
          {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        </button>
      )}
    </div>
  )
}

const makeDraft = (activity: Activity): ActivityDraft => {
  const displayStart = activity.merged_start_time ?? activity.start_time
  const displayEnd =
    activity.merged_end_time ?? activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)
  const exerciseType = (activity.data as Record<string, unknown> | undefined)?.exerciseTypeName as
    | string
    | undefined
  return {
    end_time: formatDateTimeLocal(displayEnd),
    exercise_type: exerciseType,
    notes: activity.notes ?? '',
    start_time: formatDateTimeLocal(displayStart),
    title: activity.title ?? '',
  }
}

const EntityContent = ({ entityType, entityId }: { entityType: EntityType; entityId: string }) => {
  const queryClient = useQueryClient()

  // Strip merged: prefix for raw operations (delete/restore/notes write)
  const isMerged = entityId.startsWith('merged:')
  const rawEntityId = isMerged ? entityId.slice('merged:'.length) : entityId

  const activityQuery = useQuery({
    enabled: entityType === 'activity',
    queryFn: () => fetchActivityById(entityId),
    queryKey: ['entity-detail', 'activity', entityId],
    staleTime: 60_000,
  })

  const tagQuery = useQuery({
    enabled: entityType === 'tag',
    queryFn: () => fetchTagById(entityId),
    queryKey: ['entity-detail', 'tag', entityId],
    staleTime: 60_000,
  })

  // Productivity: fetch a 1-second window around the record start_time to locate it.
  // We use a broad 24h window keyed on the id; the matching record is found by id.
  const productivityQuery = useQuery({
    enabled: entityType === 'productivity',
    queryFn: async () => {
      // Fetch a full day's worth of data and find the record by id
      const now = new Date()
      const dayStart = new Date(now)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(now)
      dayEnd.setHours(23, 59, 59, 999)
      // Try today first, then fall back to a wider 7-day window
      const records = await fetchProductivity(new Date(Date.now() - 7 * 86400000), dayEnd)
      return records.find((r) => r.id === entityId || r.source_ids?.includes(entityId)) ?? null
    },
    queryKey: ['entity-detail', 'productivity', entityId],
    staleTime: 60_000,
  })

  const invalidateEntity = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['entity-detail', entityType, entityId] })
  }, [queryClient, entityType, entityId])

  const isLoading =
    entityType === 'activity' ? activityQuery.isLoading
    : entityType === 'tag' ? tagQuery.isLoading
    : entityType === 'productivity' ? productivityQuery.isLoading
    : false // metric detail handles its own loading
  const isError =
    entityType === 'activity' ? activityQuery.isError
    : entityType === 'tag' ? tagQuery.isError
    : entityType === 'productivity' ? productivityQuery.isError
    : false

  const activity = activityQuery.data
  const tag = tagQuery.data
  const productivityRecord = productivityQuery.data

  const isDeleted =
    entityType === 'activity' ? Boolean(activity?.deleted_at)
    : entityType === 'tag' ? Boolean(tag?.deleted_at)
    : false

  // For metrics, only manual entries can be deleted
  const isManualMetric = entityType === 'metric' && parseMetricEntityId(entityId)?.source === 'manual'

  // Edit state
  const [isEditing, setIsEditing] = useState(false)
  const emptyDraft: ActivityDraft = { end_time: '', notes: '', start_time: '', title: '' }
  const [draft, setDraft] = useState<ActivityDraft>(emptyDraft)

  const isMergedActivity = Boolean(
    entityType === 'activity' && activity?.source_records && activity.source_records.length > 1,
  )

  const startEditing = useCallback(() => {
    if (!activity) return
    setDraft(makeDraft(activity))
    setIsEditing(true)
  }, [activity])

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setDraft(emptyDraft)
  }, [])

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!activity) return Promise.resolve()
      const body: {
        start_time?: string
        end_time?: string
        title?: string
        notes?: string
        exercise_type?: ExerciseTypeName
      } = {}
      const originalDraft = makeDraft(activity)
      if (draft.title !== originalDraft.title) body.title = draft.title
      if (draft.start_time !== originalDraft.start_time)
        body.start_time = new Date(draft.start_time).toISOString()
      if (draft.end_time !== originalDraft.end_time) body.end_time = new Date(draft.end_time).toISOString()
      if (draft.notes !== originalDraft.notes) body.notes = draft.notes
      if (draft.exercise_type !== originalDraft.exercise_type && draft.exercise_type)
        body.exercise_type = draft.exercise_type as ExerciseTypeName
      if (Object.keys(body).length === 0) return Promise.resolve()
      return updateActivity(rawEntityId, body)
    },
    onSuccess: () => {
      setIsEditing(false)
      invalidateEntity()
    },
  })

  const handleSave = useCallback(() => {
    saveMutation.mutate()
  }, [saveMutation])

  // Collect all entity IDs for notes (primary + source records for merged activities/productivity)
  const allEntityIds =
    entityType === 'activity' && activity?.source_records ? activity.source_records.map((r) => r.id)
    : entityType === 'productivity' && productivityRecord?.source_ids ? productivityRecord.source_ids
    : undefined

  if (isLoading) return <p class="loading">Loading…</p>
  if (isError) return <p class="error">Failed to load {entityType}</p>

  return (
    <>
      {/* Metrics only support delete for manual entries; hide actions for non-manual metrics */}
      {entityType !== 'metric' || isManualMetric ?
        <EntityActions
          entityType={entityType}
          entityId={rawEntityId}
          isDeleted={isDeleted}
          onMutationSuccess={entityType === 'metric' ? () => history.back() : invalidateEntity}
          canEdit={entityType === 'activity'}
          isMerged={isMergedActivity}
          isEditing={isEditing}
          onStartEditing={startEditing}
          onCancelEditing={cancelEditing}
          onSave={handleSave}
          isSaving={saveMutation.isPending}
        />
      : null}

      {entityType === 'activity' && activity && (
        <ActivityDetailDispatch
          activity={activity}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={setDraft}
        />
      )}
      {entityType === 'tag' && tag && <TagDetail tag={tag} />}
      {entityType === 'productivity' && productivityRecord && (
        <ProductivityDetail record={productivityRecord} />
      )}
      {entityType === 'metric' && <MetricDetail entityId={entityId} />}

      <NotesSection entityType={entityType} entityId={rawEntityId} allEntityIds={allEntityIds} />
    </>
  )
}

const VALID_ENTITY_TYPES = new Set<string>(['activity', 'tag', 'productivity', 'metric'])

export const EntityDetail = () => {
  const { params } = useRoute()
  const entityType = params.type as EntityType
  const entityId = decodeURIComponent(params.id as string)

  if (!VALID_ENTITY_TYPES.has(entityType)) {
    return (
      <div class="entity-detail-page">
        <p class="error">Unknown entity type: {entityType}</p>
      </div>
    )
  }

  return (
    <div class="entity-detail-page">
      <EntityContent entityType={entityType} entityId={entityId} />
    </div>
  )
}
