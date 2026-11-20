import type { NoteTemplate } from '@aurboda/api-spec'

import { NOTE_TEMPLATE_CONTENT_MAX_LENGTH, NOTE_TEMPLATE_NAME_MAX_LENGTH } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import {
  addNoteTemplate,
  deleteNoteTemplate,
  fetchNoteTemplates,
  restoreNoteTemplate,
  updateNoteTemplate,
} from '../../state/api'
import { daysLeft, daysLeftLabel } from './journal-list'

export const TEMPLATES_KEY = ['note-templates'] as const
export const DELETED_TEMPLATES_KEY = ['note-templates', 'deleted'] as const

export const useTemplates = () => useQuery({ queryFn: () => fetchNoteTemplates(), queryKey: TEMPLATES_KEY })

const TemplateForm = ({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { name: string; content: string }
  submitLabel: string
  onSubmit: (value: { name: string; content: string }) => Promise<unknown>
  onCancel: () => void
}) => {
  const [name, setName] = useState(initial.name)
  const [content, setContent] = useState(initial.content)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  const submit = async (event: Event) => {
    event.preventDefault()
    if (!name.trim() || !content.trim()) return setError('A template needs a name and some text.')
    setSaving(true)
    setError(undefined)
    try {
      await onSubmit({ content, name: name.trim() })
    } catch {
      setError('The template could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form class="journal-template-form" onSubmit={submit}>
      <label class="journal-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          maxLength={NOTE_TEMPLATE_NAME_MAX_LENGTH}
          placeholder="Evening reflection"
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>
      <label class="journal-field">
        <span>Text</span>
        <textarea
          rows={5}
          value={content}
          maxLength={NOTE_TEMPLATE_CONTENT_MAX_LENGTH}
          placeholder={'## What went well today?\n\n## What would I do differently?'}
          onInput={(e) => setContent(e.currentTarget.value)}
        />
      </label>
      {error && (
        <p class="journal-error" role="alert">
          {error}
        </p>
      )}
      <div class="journal-row">
        <button type="submit" class="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" class="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The person's own starting texts: add, edit, delete, and bring back a deleted one. */
export const TemplateManager = () => {
  const queryClient = useQueryClient()
  const templates = useTemplates()
  const deleted = useQuery({
    queryFn: () => fetchNoteTemplates({ deleted: true }),
    queryKey: DELETED_TEMPLATES_KEY,
  })
  const [editing, setEditing] = useState<'new' | string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY })
  const remove = useMutation({ mutationFn: (id: string) => deleteNoteTemplate(id), onSuccess: refresh })
  const restore = useMutation({ mutationFn: (id: string) => restoreNoteTemplate(id), onSuccess: refresh })

  const list: NoteTemplate[] = templates.data ?? []

  return (
    <div class="journal-templates">
      {list.length === 0 && editing !== 'new' && (
        <p class="journal-muted">
          No templates yet. A template is a text a new entry starts from, like a few questions to answer.
        </p>
      )}
      {list.length > 0 && (
        <ul class="journal-template-list">
          {list.map((template) =>
            editing === template.id ? (
              <li key={template.id}>
                <TemplateForm
                  initial={template}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (value) => {
                    await updateNoteTemplate(template.id, value)
                    await refresh()
                    setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={template.id} class="journal-template-row">
                <span>{template.name}</span>
                <span class="journal-row">
                  <button type="button" class="journal-link-btn" onClick={() => setEditing(template.id)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    class="journal-link-btn"
                    onClick={() => remove.mutate(template.id)}
                    disabled={remove.isPending}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <TemplateForm
          initial={{ content: '', name: '' }}
          submitLabel="Add template"
          onCancel={() => setEditing(null)}
          onSubmit={async (value) => {
            await addNoteTemplate(value)
            await refresh()
            setEditing(null)
          }}
        />
      ) : (
        <button type="button" class="btn-secondary" onClick={() => setEditing('new')}>
          Add a template
        </button>
      )}
      {(deleted.data ?? []).length > 0 && (
        <div class="journal-template-deleted">
          <h4>Deleted templates</h4>
          <ul class="journal-template-list">
            {(deleted.data ?? []).map((template) => (
              <li key={template.id} class="journal-template-row">
                <span>
                  {template.name}{' '}
                  <small class="journal-muted">{daysLeftLabel(daysLeft(template.purge_at))}</small>
                </span>
                <button
                  type="button"
                  class="journal-link-btn"
                  onClick={() => restore.mutate(template.id)}
                  disabled={restore.isPending}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
