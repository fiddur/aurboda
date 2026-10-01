import type { EntityType, Note } from '@aurboda/api-spec'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'preact/hooks'

import { CommentThread } from '../../components/CommentThread'
import { fromDatetimeLocal, toDatetimeLocal } from '../../components/CommentThread/datetimeLocal'
import { MarkdownEditor } from '../../components/MarkdownEditor'
import { SaveCancelRow } from '../../components/SaveCancelRow'
import { addReply, addTimeComment, deleteComment, updateComment } from '../../state/api'
import { entityHref } from './commentItems'
import './CommentPanel.css'

export type CommentPanelState =
  /** Existing threads (several when their glyphs shared one), looked up among the roots the range query already returned. */
  | { kind: 'thread'; rootIds: string[] }
  /** A comment about a moment that has nothing attached to it yet. */
  | { kind: 'new'; at: Date }

interface CommentPanelProps {
  state: CommentPanelState
  /** Thread roots in the visible window, replies already nested. */
  roots: Note[]
  onClose: () => void
}

const ENTITY_LABELS: Partial<Record<EntityType, string>> = {
  activity: 'activity',
  meal: 'meal',
  metric: 'metric point',
  productivity: 'screen time record',
  report: 'report',
}

const AnchorLine = ({ root }: { root: Note }) => {
  const href = root.entity_id ? entityHref(root.entity_type, root.entity_id) : undefined
  if (!href) return null
  const label = ENTITY_LABELS[root.entity_type] ?? root.entity_type
  return (
    <p class="comment-panel-anchor">
      On this <a href={href}>{label}</a>
    </p>
  )
}

const NewCommentForm = ({ at, onDone }: { at: Date; onDone: () => void }) => {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [start, setStart] = useState(toDatetimeLocal(at))
  const [end, setEnd] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const startAt = fromDatetimeLocal(start)
      if (!startAt) throw new Error('A comment about a moment needs a start time')
      return addTimeComment(content.trim(), startAt, fromDatetimeLocal(end))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline-comments'] })
      onDone()
    },
  })

  return (
    <div class="comment-panel-new">
      <MarkdownEditor
        value={content}
        onChange={setContent}
        placeholder="What happened at this moment?"
        rows={4}
      />
      <div class="comment-panel-times">
        <label>
          From
          <input
            type="datetime-local"
            value={start}
            onInput={(e) => setStart((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          To (optional)
          <input
            type="datetime-local"
            value={end}
            onInput={(e) => setEnd((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      {mutation.isError && <p class="comment-panel-error">{mutation.error.message}</p>}
      <SaveCancelRow
        onSave={() => content.trim() && start && mutation.mutate()}
        onCancel={onDone}
        isPending={mutation.isPending}
        saveLabel="Add comment"
        savingLabel="Adding…"
      />
    </div>
  )
}

/**
 * The comment thread for one 💬 bubble, or the composer for a brand-new comment
 * at a picked moment. Opening an existing thread costs no request: the roots the
 * Timeline already fetched carry their replies.
 */
export const CommentPanel = ({ state, roots, onClose }: CommentPanelProps) => {
  const queryClient = useQueryClient()

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['timeline-comments'] })
    // An entity page open behind the Timeline reads the same comments under a
    // different key — keep them from drifting apart.
    queryClient.invalidateQueries({ queryKey: ['notes'] })
  }, [queryClient])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const threadRoots =
    state.kind === 'thread' ? roots.filter((note) => note.id && state.rootIds.includes(note.id)) : []

  const replyMutation = useMutation({
    mutationFn: ({ rootId, content }: { rootId: string; content: string }) => addReply(rootId, content),
    onSuccess: invalidate,
  })

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateComment(id, { content }),
    onSuccess: invalidate,
  })

  const timesMutation = useMutation({
    mutationFn: ({ id, start, end }: { id: string; start: Date; end?: Date }) =>
      updateComment(id, {
        // Explicitly null rather than omitted: clearing the To field must clear
        // the end, not silently leave the old one in place.
        end_time: end ? end.toISOString() : null,
        start_time: start.toISOString(),
      }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: (_data, id) => {
      invalidate()
      if (state.kind === 'thread' && state.rootIds.length === 1 && id === state.rootIds[0]) onClose()
    },
  })

  const pending =
    replyMutation.isPending || editMutation.isPending || timesMutation.isPending || deleteMutation.isPending

  return (
    <>
      <div class="comment-panel-backdrop" onClick={onClose} />
      <div class="comment-panel" role="dialog" aria-label="Comment">
        <div class="comment-panel-header">
          <h3>{state.kind === 'new' ? 'New comment' : threadRoots.length > 1 ? 'Comments' : 'Comment'}</h3>
          <button class="comment-panel-close" type="button" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {state.kind === 'new' && <NewCommentForm at={state.at} onDone={onClose} />}

        {state.kind === 'thread' && threadRoots.length === 0 && (
          <p class="comment-panel-empty">This comment is gone.</p>
        )}

        {threadRoots.map((root) => (
          <div class="comment-panel-thread" key={root.id}>
            <AnchorLine root={root} />
            <CommentThread
              comments={[root]}
              onAddReply={(rootId, content) => replyMutation.mutate({ content, rootId })}
              onEdit={(id, content) => editMutation.mutate({ content, id })}
              onEditTimes={
                root.entity_type === 'time'
                  ? (id, start, end) => timesMutation.mutate({ end, id, start })
                  : undefined
              }
              onDelete={(id) => deleteMutation.mutate(id)}
              pending={pending}
            />
          </div>
        ))}
      </div>
    </>
  )
}
