import type { Note } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { format } from 'date-fns'
import { useCallback, useState } from 'preact/hooks'

import { renderMarkdown } from '../../utils/markdown'
import { ConfirmButton } from '../ConfirmButton'
import { MarkdownEditor } from '../MarkdownEditor'
import { SaveCancelRow } from '../SaveCancelRow'
import { fromDatetimeLocal, toDatetimeLocal } from './datetimeLocal'
import './style.css'

export interface CommentThreadProps {
  /** Thread roots, each carrying its replies nested (oldest first). */
  comments: Note[]
  isLoading?: boolean
  onAddRoot?: (content: string) => void
  onAddReply: (rootId: string, content: string) => void
  onEdit: (id: string, content: string) => void
  /** Only passed where the roots are `time` comments — every other shape mirrors its entity. */
  onEditTimes?: (id: string, start: Date, end?: Date) => void
  onDelete: (id: string) => void
  pending?: boolean
}

const formatWhen = (value: string | undefined): string =>
  value ? format(new Date(value), 'yyyy-MM-dd HH:mm') : ''

interface CommentEntryProps {
  id: string | undefined
  content: string
  createdAt: string | undefined
  /** Set for comments authored by a data source — their content is owned by the sync. */
  source: string | undefined
  entryClass: string
  onEdit: (id: string, content: string) => void
  onDelete: (id: string) => void
  pending?: boolean
  children?: ComponentChildren
}

/**
 * One comment — a thread root or a reply. Synced comments (`source` set) get no
 * Edit button: the next sync would overwrite whatever was typed here.
 */
const CommentEntry = ({
  id,
  content,
  createdAt,
  source,
  entryClass,
  onEdit,
  onDelete,
  pending,
  children,
}: CommentEntryProps) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)

  const startEdit = useCallback(() => {
    setDraft(content)
    setEditing(true)
  }, [content])

  const saveEdit = useCallback(() => {
    if (!id || !draft.trim()) return
    onEdit(id, draft.trim())
    setEditing(false)
  }, [draft, id, onEdit])

  if (editing) {
    return (
      <div class={`${entryClass} comment-edit-form`}>
        <MarkdownEditor value={draft} onChange={setDraft} rows={3} />
        <SaveCancelRow onSave={saveEdit} onCancel={() => setEditing(false)} isPending={pending} />
      </div>
    )
  }

  return (
    <div class={entryClass}>
      <div class="comment-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      {children}
      <div class="comment-footer">
        <span class="comment-date">{formatWhen(createdAt)}</span>
        {source && (
          <span class="comment-source" title={`Written by ${source} — synced, not editable here`}>
            {source}
          </span>
        )}
        <div class="comment-actions">
          {!source && (
            <button class="comment-action-btn" onClick={startEdit} type="button" disabled={!id}>
              Edit
            </button>
          )}
          <ConfirmButton
            label="Delete"
            confirmMessage="Delete?"
            buttonClass="comment-action-btn danger"
            onConfirm={() => id && onDelete(id)}
            isPending={pending}
            disabled={!id}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Start/end editor for a comment anchored to a moment rather than an entity.
 * Only those carry times of their own — everywhere else they mirror the parent.
 */
const CommentTimes = ({
  root,
  onEditTimes,
  pending,
}: {
  root: Note
  onEditTimes: (id: string, start: Date, end?: Date) => void
  pending?: boolean
}) => {
  const savedStart = toDatetimeLocal(root.start_time)
  const savedEnd = toDatetimeLocal(root.end_time)
  const [start, setStart] = useState(savedStart)
  const [end, setEnd] = useState(savedEnd)

  const dirty = start !== savedStart || end !== savedEnd

  const save = useCallback(() => {
    const parsedStart = fromDatetimeLocal(start)
    if (!parsedStart || !root.id) return
    onEditTimes(root.id, parsedStart, fromDatetimeLocal(end))
  }, [end, onEditTimes, root.id, start])

  return (
    <div class="comment-times">
      <label>
        From
        <input
          type="datetime-local"
          value={start}
          onInput={(e) => setStart((e.target as HTMLInputElement).value)}
        />
      </label>
      <label>
        To
        <input
          type="datetime-local"
          value={end}
          onInput={(e) => setEnd((e.target as HTMLInputElement).value)}
        />
      </label>
      {dirty && (
        <button class="comment-action-btn" type="button" onClick={save} disabled={pending || !start}>
          Save times
        </button>
      )}
    </div>
  )
}

/** Collapsed "Reply…" link that opens a markdown box. Always replies to the root. */
const ReplyBox = ({
  rootId,
  onAddReply,
  pending,
}: {
  rootId: string
  onAddReply: (rootId: string, content: string) => void
  pending?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const close = useCallback(() => {
    setDraft('')
    setOpen(false)
  }, [])

  const send = useCallback(() => {
    if (!draft.trim()) return
    onAddReply(rootId, draft.trim())
    close()
  }, [close, draft, onAddReply, rootId])

  if (!open) {
    return (
      <button class="comment-reply-link" type="button" onClick={() => setOpen(true)}>
        Reply…
      </button>
    )
  }

  return (
    <div class="comment-reply-form">
      <MarkdownEditor value={draft} onChange={setDraft} placeholder="Reply…" rows={2} />
      <SaveCancelRow
        onSave={send}
        onCancel={close}
        isPending={pending}
        saveLabel="Reply"
        savingLabel="Replying…"
      />
    </div>
  )
}

const ThreadRoot = ({
  root,
  onAddReply,
  onEdit,
  onEditTimes,
  onDelete,
  pending,
}: {
  root: Note
} & Pick<CommentThreadProps, 'onAddReply' | 'onEdit' | 'onEditTimes' | 'onDelete' | 'pending'>) => {
  const replies = root.replies ?? []

  return (
    <div class="comment-thread-root">
      <CommentEntry
        entryClass="comment-item"
        id={root.id}
        content={root.content}
        createdAt={root.created_at}
        source={root.source}
        onEdit={onEdit}
        onDelete={onDelete}
        pending={pending}
      >
        {onEditTimes && root.entity_type === 'time' && (
          <CommentTimes root={root} onEditTimes={onEditTimes} pending={pending} />
        )}
      </CommentEntry>

      {replies.length > 0 && (
        <div class="comment-replies">
          {replies.map((reply) => (
            <CommentEntry
              key={reply.id}
              entryClass="comment-item comment-reply"
              id={reply.id}
              content={reply.content}
              createdAt={reply.created_at}
              source={reply.source}
              onEdit={onEdit}
              onDelete={onDelete}
              pending={pending}
            />
          ))}
        </div>
      )}

      {root.id && <ReplyBox rootId={root.id} onAddReply={onAddReply} pending={pending} />}
    </div>
  )
}

/**
 * The one place a comment thread is rendered — used by the Timeline's comment
 * panel and by every entity page. Threads are one level deep: a reply always
 * hangs off the root, never off another reply.
 */
export const CommentThread = ({
  comments,
  isLoading,
  onAddRoot,
  onAddReply,
  onEdit,
  onEditTimes,
  onDelete,
  pending,
}: CommentThreadProps) => {
  const [draft, setDraft] = useState('')

  const handleAdd = useCallback(
    (e: Event) => {
      e.preventDefault()
      if (!onAddRoot || !draft.trim()) return
      onAddRoot(draft.trim())
      setDraft('')
    },
    [draft, onAddRoot],
  )

  return (
    <div class="comment-thread">
      {isLoading && <p class="comment-loading">Loading comments…</p>}

      {comments.length > 0 && (
        <div class="comment-list">
          {comments.map((root) => (
            <ThreadRoot
              key={root.id}
              root={root}
              onAddReply={onAddReply}
              onEdit={onEdit}
              onEditTimes={onEditTimes}
              onDelete={onDelete}
              pending={pending}
            />
          ))}
        </div>
      )}

      {onAddRoot && (
        <form class="comment-add-form" onSubmit={handleAdd}>
          <MarkdownEditor value={draft} onChange={setDraft} placeholder="Add a comment…" rows={3} />
          <button type="submit" class="btn-primary" disabled={!draft.trim() || pending}>
            {pending ? 'Adding…' : 'Add Comment'}
          </button>
        </form>
      )}
    </div>
  )
}
