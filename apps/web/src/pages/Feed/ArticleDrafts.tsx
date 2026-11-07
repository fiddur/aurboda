import type { ArticleDraft } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'

import { ConfirmButton } from '../../components/ConfirmButton'
import { deleteArticleDraft, fetchArticleDrafts } from '../../state/api'

const DraftRow = ({ draft, onContinue }: { draft: ArticleDraft; onContinue: () => void }) => {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteArticleDraft(draft.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['articleDrafts'] }),
  })
  const title = draft.article.title.trim()
  return (
    <li class="feed-draft-row">
      <div class="feed-draft-main">
        <span class={title ? 'feed-draft-title' : 'feed-draft-title feed-draft-title--untitled'}>
          {title || 'Untitled draft'}
        </span>
        <span class="feed-draft-meta">
          edited {formatDistanceToNow(new Date(draft.updated_at), { addSuffix: true })}
        </span>
      </div>
      <div class="feed-draft-actions">
        <button type="button" class="btn-secondary" onClick={onContinue}>
          Continue
        </button>
        <ConfirmButton
          label="Delete"
          confirmMessage="Delete this draft?"
          onConfirm={() => remove.mutate()}
          isPending={remove.isPending}
          pendingLabel="Deleting…"
        />
      </div>
    </li>
  )
}

/** Your saved, unpublished articles; nothing renders when there are none. */
export const ArticleDrafts = ({ onContinue }: { onContinue: (draft: ArticleDraft) => void }) => {
  const { data: drafts } = useQuery({ queryFn: fetchArticleDrafts, queryKey: ['articleDrafts'] })
  if (!drafts?.length) return null
  return (
    <div class="feed-drafts">
      <h3 class="feed-drafts-title">Drafts</h3>
      <ul class="feed-drafts-list">
        {drafts.map((draft) => (
          <DraftRow key={draft.id} draft={draft} onContinue={() => onContinue(draft)} />
        ))}
      </ul>
    </div>
  )
}
