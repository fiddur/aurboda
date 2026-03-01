/**
 * Entity detail page — shows an activity, tag, productivity record, or metric data point
 * with notes and action buttons (delete / restore).
 *
 * Activities dispatch to type-specific detail components:
 * - sleep/nap -> SleepDetail (hypnogram, Oura metrics, HR/HRV)
 * - exercise  -> ExerciseDetail (HR chart, HR zones)
 * - other     -> generic ActivityDetail (HR/HRV chart)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'
import {
  Activity,
  deleteMetricPoint,
  type ExerciseTypeName,
  fetchActivityById,
  fetchProductivity,
  fetchTagById,
  type ProductivityRecord,
  restoreActivity,
  restoreProductivity,
  restoreTag,
  softDeleteActivity,
  softDeleteProductivity,
  softDeleteTag,
  SourceRecord,
  updateActivity,
} from '../../state/api'
import { ActivityChart } from './ActivityChart'
import { type ActivityDraft, EditableActivityFields } from './EditableActivityFields'
import { ExerciseDetail } from './ExerciseDetail'
import { formatDateTimeLocal, formatTime } from './format-utils'
import { MetricDetail, parseMetricEntityId } from './MetricDetail'
import { MusicPlaylist } from './MusicPlaylist'
import { NotesSection } from './NotesSection'
import { ProductivityDetail } from './ProductivityDetail'
import { SleepDetail } from './SleepDetail'
import { TagDetail } from './TagDetail'

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
          {restoreMutation.isPending ? 'Restoring...' : 'Restore'}
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
            {isSaving ? 'Saving...' : 'Save'}
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
          {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
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

/** Activity entity content with edit/save logic. */
const ActivityContent = ({ entityId }: { entityId: string }) => {
  const queryClient = useQueryClient()
  const isMerged = entityId.startsWith('merged:')
  const rawEntityId = isMerged ? entityId.slice('merged:'.length) : entityId

  const {
    data: activity,
    isLoading,
    isError,
  } = useQuery({
    queryFn: () => fetchActivityById(entityId),
    queryKey: ['entity-detail', 'activity', entityId],
    staleTime: 60_000,
  })

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['entity-detail', 'activity', entityId] }),
    [queryClient, entityId],
  )

  const [isEditing, setIsEditing] = useState(false)
  const emptyDraft: ActivityDraft = { end_time: '', notes: '', start_time: '', title: '' }
  const [draft, setDraft] = useState<ActivityDraft>(emptyDraft)

  const isMergedActivity = Boolean(activity?.source_records && activity.source_records.length > 1)

  const startEditing = useCallback(() => {
    if (!activity) return
    setDraft(makeDraft(activity))
    setIsEditing(true)
  }, [activity])

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
      const orig = makeDraft(activity)
      if (draft.title !== orig.title) body.title = draft.title
      if (draft.start_time !== orig.start_time) body.start_time = new Date(draft.start_time).toISOString()
      if (draft.end_time !== orig.end_time) body.end_time = new Date(draft.end_time).toISOString()
      if (draft.notes !== orig.notes) body.notes = draft.notes
      if (draft.exercise_type !== orig.exercise_type && draft.exercise_type)
        body.exercise_type = draft.exercise_type as ExerciseTypeName
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
      />
      <ActivityDetailDispatch
        activity={activity}
        isEditing={isEditing}
        draft={draft}
        onDraftChange={setDraft}
      />
      <NotesSection entityType="activity" entityId={rawEntityId} allEntityIds={allEntityIds} />
    </>
  )
}

/** Tag entity content. */
const TagContent = ({ entityId }: { entityId: string }) => {
  const queryClient = useQueryClient()
  const {
    data: tag,
    isLoading,
    isError,
  } = useQuery({
    queryFn: () => fetchTagById(entityId),
    queryKey: ['entity-detail', 'tag', entityId],
    staleTime: 60_000,
  })

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['entity-detail', 'tag', entityId] }),
    [queryClient, entityId],
  )

  if (isLoading) return <p class="loading">Loading...</p>
  if (isError || !tag) return <p class="error">Failed to load tag</p>

  return (
    <>
      <EntityActions
        entityType="tag"
        entityId={entityId}
        isDeleted={Boolean(tag.deleted_at)}
        onMutationSuccess={invalidate}
        canEdit={false}
        isMerged={false}
        isEditing={false}
        onStartEditing={() => {}}
        onCancelEditing={() => {}}
        onSave={() => {}}
        isSaving={false}
      />
      <TagDetail tag={tag} />
      <NotesSection entityType="tag" entityId={entityId} />
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
    queryFn: async (): Promise<ProductivityRecord | null> => {
      const dayEnd = new Date()
      dayEnd.setHours(23, 59, 59, 999)
      const records = await fetchProductivity(new Date(Date.now() - 7 * 86400000), dayEnd)
      return records.find((r) => r.id === entityId || r.source_ids?.includes(entityId)) ?? null
    },
    queryKey: ['entity-detail', 'productivity', entityId],
    staleTime: 60_000,
  })

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['entity-detail', 'productivity', entityId] }),
    [queryClient, entityId],
  )

  if (isLoading) return <p class="loading">Loading...</p>
  if (isError || !record) return <p class="error">Failed to load productivity record</p>

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
      <ProductivityDetail record={record} />
      <NotesSection entityType="productivity" entityId={entityId} allEntityIds={allEntityIds} />
    </>
  )
}

/** Metric entity content. */
const MetricContent = ({ entityId }: { entityId: string }) => {
  const isManual = parseMetricEntityId(entityId)?.source === 'manual'

  return (
    <>
      {isManual && (
        <EntityActions
          entityType="metric"
          entityId={entityId}
          isDeleted={false}
          onMutationSuccess={() => history.back()}
          canEdit={false}
          isMerged={false}
          isEditing={false}
          onStartEditing={() => {}}
          onCancelEditing={() => {}}
          onSave={() => {}}
          isSaving={false}
        />
      )}
      <MetricDetail entityId={entityId} />
      <NotesSection entityType="metric" entityId={entityId} />
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
      {entityType === 'activity' && <ActivityContent entityId={entityId} />}
      {entityType === 'tag' && <TagContent entityId={entityId} />}
      {entityType === 'productivity' && <ProductivityContent entityId={entityId} />}
      {entityType === 'metric' && <MetricContent entityId={entityId} />}
    </div>
  )
}
