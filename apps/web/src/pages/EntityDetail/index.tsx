/**
 * Entity detail page — shows an activity, tag, or productivity record
 * with notes and action buttons (delete / restore).
 *
 * Activities dispatch to type-specific detail components:
 * - sleep/nap → SleepDetail (hypnogram, Oura metrics, HR/HRV)
 * - exercise  → ExerciseDetail (HR chart, HR zones)
 * - other     → generic ActivityDetail (HR/HRV chart)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'
import {
  Activity,
  type ExerciseTypeName,
  fetchActivityById,
  fetchTagById,
  restoreActivity,
  restoreTag,
  softDeleteActivity,
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

type EntityType = 'activity' | 'tag' | 'productivity'

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

const deleteEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity') return softDeleteActivity(entityId)
  if (entityType === 'tag') return softDeleteTag(entityId)
  return Promise.reject(new Error('Unsupported entity type for delete'))
}

const restoreEntity = (entityType: EntityType, entityId: string): Promise<void> => {
  if (entityType === 'activity') return restoreActivity(entityId)
  if (entityType === 'tag') return restoreTag(entityId)
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

  const invalidateEntity = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['entity-detail', entityType, entityId] })
  }, [queryClient, entityType, entityId])

  const isLoading = entityType === 'activity' ? activityQuery.isLoading : tagQuery.isLoading
  const isError = entityType === 'activity' ? activityQuery.isError : tagQuery.isError

  const activity = activityQuery.data
  const tag = tagQuery.data

  const isDeleted =
    entityType === 'activity' ? Boolean(activity?.deleted_at)
    : entityType === 'tag' ? Boolean(tag?.deleted_at)
    : false

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

  // Collect all entity IDs for notes (primary + source records for merged activities)
  const allEntityIds =
    entityType === 'activity' && activity?.source_records ?
      activity.source_records.map((r) => r.id)
    : undefined

  if (isLoading) return <p class="loading">Loading…</p>
  if (isError) return <p class="error">Failed to load {entityType}</p>

  return (
    <>
      <EntityActions
        entityType={entityType}
        entityId={rawEntityId}
        isDeleted={isDeleted}
        onMutationSuccess={invalidateEntity}
        canEdit={entityType === 'activity'}
        isMerged={isMergedActivity}
        isEditing={isEditing}
        onStartEditing={startEditing}
        onCancelEditing={cancelEditing}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />

      {entityType === 'activity' && activity && (
        <ActivityDetailDispatch
          activity={activity}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={setDraft}
        />
      )}
      {entityType === 'tag' && tag && <TagDetail tag={tag} />}

      <NotesSection entityType={entityType} entityId={rawEntityId} allEntityIds={allEntityIds} />
    </>
  )
}

const VALID_ENTITY_TYPES = new Set<string>(['activity', 'tag', 'productivity'])

export const EntityDetail = () => {
  const { params } = useRoute()
  const entityType = params.type as EntityType
  const entityId = params.id as string

  if (!VALID_ENTITY_TYPES.has(entityType)) {
    return (
      <div class="entity-detail-page">
        <p class="error">Unknown entity type: {entityType}</p>
      </div>
    )
  }

  return (
    <div class="entity-detail-page">
      <div class="entity-detail-header">
        <button type="button" class="back-link back-link-btn" onClick={() => history.back()}>
          Back
        </button>
      </div>
      <EntityContent entityType={entityType} entityId={entityId} />
    </div>
  )
}
