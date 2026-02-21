/**
 * Entity detail page — shows an activity, tag, or productivity record
 * with notes and action buttons (delete / restore).
 *
 * Activities dispatch to type-specific detail components:
 * - sleep/nap → SleepDetail (hypnogram, Oura metrics, HR/HRV)
 * - exercise  → ExerciseDetail (HR chart, HR zones)
 * - other     → generic ActivityDetail
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { marked } from 'marked'
import { useRoute } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'
import { MarkdownEditor } from '../../components/MarkdownEditor/index.jsx'
import {
  Activity,
  addNote,
  deleteNote,
  fetchActivityById,
  fetchNotes,
  fetchTagById,
  NoteData,
  restoreActivity,
  restoreTag,
  softDeleteActivity,
  softDeleteTag,
  Tag,
  updateNote,
} from '../../state/api'
import { ExerciseDetail } from './ExerciseDetail'
import { MusicPlaylist } from './MusicPlaylist'
import { SleepDetail } from './SleepDetail'

import './style.css'

marked.setOptions({ breaks: true, gfm: true })

type EntityType = 'activity' | 'tag' | 'productivity'

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

/** Generic activity detail for types other than sleep/exercise. */
const GenericActivityDetail = ({ activity }: { activity: Activity }) => {
  const end = activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)
  const exerciseType = (activity.data as Record<string, unknown> | undefined)?.exerciseTypeName as
    | string
    | undefined

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">{activity.activity_type}</span>
        {activity.source && <span class="entity-source">Source: {activity.source}</span>}
      </div>

      <h2>{activity.title || exerciseType || activity.activity_type}</h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">
            {formatDateTime(activity.start_time)} – {formatTime(end)}
          </span>
        </div>
        <div class="field-row">
          <span class="field-label">Duration</span>
          <span class="field-value">{formatDuration(activity.start_time, end)}</span>
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
    </div>
  )
}

/** Dispatch to type-specific activity detail component. */
const ActivityDetailDispatch = ({ activity }: { activity: Activity }) => {
  const end = activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60000)

  const isSleep = activity.activity_type === 'sleep' || activity.activity_type === 'nap'
  const isExercise = activity.activity_type === 'exercise'

  return (
    <>
      {isSleep && <SleepDetail activity={activity} />}
      {isExercise && <ExerciseDetail activity={activity} />}
      {!isSleep && !isExercise && <GenericActivityDetail activity={activity} />}

      <div class="detail-grid">
        <MusicPlaylist start={activity.start_time} end={end} />
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

const NotesSection = ({ entityType, entityId }: { entityType: EntityType; entityId: string }) => {
  const queryClient = useQueryClient()
  const [newNote, setNewNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const notesQuery = useQuery({
    queryFn: () => fetchNotes(entityType, entityId),
    queryKey: ['notes', entityType, entityId],
    staleTime: 30_000,
  })

  const invalidateNotes = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['notes', entityType, entityId] }),
    [queryClient, entityType, entityId],
  )

  const addMutation = useMutation({
    mutationFn: () => addNote(entityType, entityId, newNote),
    onSuccess: () => {
      setNewNote('')
      invalidateNotes()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateNote(id, content),
    onSuccess: () => {
      setEditingId(null)
      invalidateNotes()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: invalidateNotes,
  })

  const handleAdd = useCallback(
    (e: Event) => {
      e.preventDefault()
      if (!newNote.trim()) return
      addMutation.mutate()
    },
    [newNote, addMutation],
  )

  const startEdit = useCallback((note: NoteData) => {
    setEditingId(note.id)
    setEditContent(note.content)
  }, [])

  const handleUpdate = useCallback(
    (e: Event) => {
      e.preventDefault()
      if (!editingId || !editContent.trim()) return
      updateMutation.mutate({ content: editContent, id: editingId })
    },
    [editingId, editContent, updateMutation],
  )

  const notes = notesQuery.data ?? []

  return (
    <div class="notes-section">
      <h3>Notes</h3>

      {notesQuery.isLoading && <p class="notes-loading">Loading notes…</p>}

      {notes.length > 0 && (
        <div class="notes-list">
          {notes.map((note) => (
            <div key={note.id} class="note-item">
              {editingId === note.id ?
                <form onSubmit={handleUpdate} class="note-edit-form">
                  <MarkdownEditor value={editContent} onChange={setEditContent} rows={3} />
                  <div class="note-edit-actions">
                    <button type="submit" class="btn-primary" disabled={updateMutation.isPending}>
                      Save
                    </button>
                    <button type="button" class="btn-secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              : <>
                  <div
                    class="note-content"
                    dangerouslySetInnerHTML={{ __html: marked.parse(note.content) as string }}
                  />
                  <div class="note-footer">
                    <span class="note-date">{format(new Date(note.created_at), 'yyyy-MM-dd HH:mm')}</span>
                    <div class="note-actions">
                      <button
                        class="note-action-btn"
                        onClick={() => startEdit(note)}
                        title="Edit note"
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        class="note-action-btn danger"
                        onClick={() => deleteMutation.mutate(note.id)}
                        title="Delete note"
                        type="button"
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              }
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} class="note-add-form">
        <MarkdownEditor value={newNote} onChange={setNewNote} placeholder="Add a note…" rows={3} />
        <button type="submit" class="btn-primary" disabled={!newNote.trim() || addMutation.isPending}>
          {addMutation.isPending ? 'Adding…' : 'Add Note'}
        </button>
      </form>
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

const EntityActions = ({
  entityType,
  entityId,
  isDeleted,
  onMutationSuccess,
}: {
  entityType: EntityType
  entityId: string
  isDeleted: boolean
  onMutationSuccess: () => void
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
      <button
        class="btn-danger"
        onClick={() => deleteMutation.mutate()}
        disabled={deleteMutation.isPending}
        type="button"
      >
        {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  )
}

const EntityContent = ({ entityType, entityId }: { entityType: EntityType; entityId: string }) => {
  const queryClient = useQueryClient()

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

  if (isLoading) return <p class="loading">Loading…</p>
  if (isError) return <p class="error">Failed to load {entityType}</p>

  return (
    <>
      <EntityActions
        entityType={entityType}
        entityId={entityId}
        isDeleted={isDeleted}
        onMutationSuccess={invalidateEntity}
      />

      {entityType === 'activity' && activity && <ActivityDetailDispatch activity={activity} />}
      {entityType === 'tag' && tag && <TagDetail tag={tag} />}

      <NotesSection entityType={entityType} entityId={entityId} />
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
        <a href="/day" class="back-link">
          Back to Day View
        </a>
      </div>
      <EntityContent entityType={entityType} entityId={entityId} />
    </div>
  )
}
