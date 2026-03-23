import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { marked } from 'marked'
import { useCallback, useState } from 'preact/hooks'

import type { EntityType } from './EntityActions'

import { MarkdownEditor } from '../../components/MarkdownEditor/index.jsx'
import { SaveCancelRow } from '../../components/SaveCancelRow'
import { addNote, deleteNote, fetchNotes, type NoteData, updateNote } from '../../state/api'

export const NotesSection = ({
  entityType,
  entityId,
  allEntityIds,
}: {
  entityType: EntityType
  entityId: string
  allEntityIds?: string[]
}) => {
  const queryClient = useQueryClient()
  const [newNote, setNewNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  // Fetch notes for all source entity IDs (merged activity) or just the one
  const idsToFetch = allEntityIds ?? [entityId]
  const notesQuery = useQuery({
    queryFn: async () => {
      const results = await Promise.all(idsToFetch.map((id) => fetchNotes(entityType, id)))
      return results
        .flat()
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    },
    queryKey: ['notes', entityType, ...idsToFetch],
    staleTime: 30_000,
  })

  const invalidateNotes = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['notes', entityType, ...idsToFetch] }),
    [queryClient, entityType, ...idsToFetch],
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

  const notes = notesQuery.data ?? []

  return (
    <div class="notes-section">
      <h3>Notes</h3>

      {notesQuery.isLoading && <p class="notes-loading">Loading notes…</p>}

      {notes.length > 0 && (
        <div class="notes-list">
          {notes.map((note) => (
            <div key={note.id} class="note-item">
              {editingId === note.id ? (
                <div class="note-edit-form">
                  <MarkdownEditor value={editContent} onChange={setEditContent} rows={3} />
                  <SaveCancelRow
                    onSave={() => {
                      if (!editingId || !editContent.trim()) return
                      updateMutation.mutate({ content: editContent, id: editingId })
                    }}
                    onCancel={() => setEditingId(null)}
                    isPending={updateMutation.isPending}
                  />
                </div>
              ) : (
                <>
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
              )}
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
