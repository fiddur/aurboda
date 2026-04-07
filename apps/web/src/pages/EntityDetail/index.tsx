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
import { useCallback, useEffect, useState } from 'preact/hooks'

import type { Activity, ActivityTypeDefinition, ExerciseTypeName, SourceRecord } from '../../state/api'

import {
  fetchActivityById,
  fetchActivityTypeDefinitions,
  fetchItemIcons,
  fetchProductivityById,
  fetchScreentimeCategories,
  updateActivity,
} from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { ActivityChart } from './ActivityChart'
import { type ActivityDraft, EditableActivityFields } from './EditableActivityFields'
import { EntityActions, type EntityType } from './EntityActions'
import { ExerciseDetail, resolveExerciseType } from './ExerciseDetail'
import { formatDateTimeLocal, formatTime } from './format-utils'
import { MergePanel } from './MergePanel'
import { MetricContent } from './MetricContent'
import { MusicPlaylist } from './MusicPlaylist'
import { NotesSection } from './NotesSection'
import { ProductivityDetail } from './ProductivityDetail'
import { SleepDetail } from './SleepDetail'
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

/** Generic activity detail for types other than sleep/exercise. */
const GenericActivityDetail = ({
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
  const displayEnd = activity.merged_end_time ?? activity.end_time
  const exerciseType = resolveExerciseType(activity)
  const typeDef = typeDefinitions?.find((d) => d.name === activity.activity_type)
  const typeIcon = typeDef?.icon ?? resolveItemIcon(`activity:${activity.activity_type}`, itemIcons)
  const typeDisplayName = typeDef?.display_name ?? toDisplayName(activity.activity_type)

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <a href={`/activity-type/${activity.activity_type}`} class="entity-type-badge">
          {typeDisplayName}
        </a>
        {activity.source && <span class="entity-source">Source: {activity.source}</span>}
      </div>

      <EditableActivityFields
        title={activity.title || exerciseType || typeDisplayName}
        displayStart={displayStart}
        displayEnd={displayEnd}
        notes={activity.notes}
        isEditing={isEditing}
        draft={draft}
        onDraftChange={onDraftChange}
        typeDefinitions={typeDefinitions}
        icon={typeIcon}
      />

      {!isEditing && activity.avg_hrv !== undefined && (
        <div class="entity-fields">
          <div class="field-row">
            <span class="field-label">Avg HRV</span>
            <span class="field-value">{activity.avg_hrv} ms</span>
          </div>
        </div>
      )}

      {displayEnd && (
        <ActivityChart start={displayStart} end={displayEnd} defaultMetrics={['heart_rate', 'hrv_rmssd']} />
      )}
    </div>
  )
}

/** Dispatch to type-specific activity detail component. */
const ActivityDetailDispatch = ({
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
  const musicStart = activity.merged_start_time ?? activity.start_time
  const musicEnd =
    activity.merged_end_time ?? activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)

  // Use display_category from type definitions to decide which detail component to show
  const typeDef = typeDefinitions?.find((d) => d.name === activity.activity_type)
  const displayCategory = typeDef?.display_category ?? 'other'
  const isSleep = displayCategory === 'sleep_rest'
  const isExercise = displayCategory === 'exercise'
  const hasSourceRecords = activity.source_records && activity.source_records.length > 1

  return (
    <>
      {hasSourceRecords && (
        <div class="merged-indicator">Merged from {activity.source_records!.length} sources</div>
      )}

      {isSleep && (
        <SleepDetail
          activity={activity}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
          itemIcons={itemIcons}
          typeDefinitions={typeDefinitions}
        />
      )}
      {isExercise && (
        <ExerciseDetail
          activity={activity}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
          itemIcons={itemIcons}
          typeDefinitions={typeDefinitions}
        />
      )}
      {!isSleep && !isExercise && (
        <GenericActivityDetail
          activity={activity}
          isEditing={isEditing}
          draft={draft}
          onDraftChange={onDraftChange}
          itemIcons={itemIcons}
          typeDefinitions={typeDefinitions}
        />
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
  const displayEnd =
    activity.merged_end_time ?? activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)
  const exerciseType = resolveExerciseType(activity)
  return {
    activity_type: activity.activity_type,
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

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!activity) return Promise.resolve()
      const body: {
        activity_type?: string
        start_time?: string
        end_time?: string
        title?: string
        notes?: string
        exercise_type?: ExerciseTypeName
      } = {}
      const orig = makeDraft(activity)
      if (draft.activity_type !== orig.activity_type) body.activity_type = draft.activity_type
      if (draft.title !== orig.title) body.title = draft.title
      if (draft.start_time !== orig.start_time) {
        body.start_time = new Date(draft.start_time).toISOString()
      }
      if (draft.end_time !== orig.end_time) {
        body.end_time = new Date(draft.end_time).toISOString()
      }
      if (draft.notes !== orig.notes) body.notes = draft.notes
      if (draft.exercise_type !== orig.exercise_type && draft.exercise_type) {
        body.exercise_type = draft.exercise_type as ExerciseTypeName
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
      {isMerging && <MergePanel activityId={rawEntityId} onCancel={() => setIsMerging(false)} />}
      <ActivityDetailDispatch
        activity={activity}
        isEditing={isEditing}
        draft={draft}
        onDraftChange={setDraft}
        itemIcons={itemIcons}
        typeDefinitions={typeDefinitions}
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
