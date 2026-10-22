import type { EntityType } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'preact/hooks'

import { CommentThread } from '../../components/CommentThread'
import { addEntityComment, addReply, deleteComment, fetchComments, updateComment } from '../../state/api'

/**
 * The comment thread on one entity. Named `NotesSection` because the storage
 * (and the API) still calls them notes — the UI word is "Comments".
 */
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

  // Fetch comments for all source entity IDs (merged activity) or just the one
  const idsToFetch = allEntityIds ?? [entityId]
  const commentsQuery = useQuery({
    queryFn: async () => {
      const results = await Promise.all(idsToFetch.map((id) => fetchComments(entityType, id)))
      return results
        .flat()
        .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
    },
    queryKey: ['notes', entityType, ...idsToFetch],
    staleTime: 30_000,
  })

  const invalidateComments = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['notes', entityType, ...idsToFetch] }),
    [queryClient, entityType, ...idsToFetch],
  )

  const addRootMutation = useMutation({
    mutationFn: (content: string) => addEntityComment(entityType, entityId, content),
    onSuccess: invalidateComments,
  })

  const addReplyMutation = useMutation({
    mutationFn: ({ rootId, content }: { rootId: string; content: string }) => addReply(rootId, content),
    onSuccess: invalidateComments,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateComment(id, { content }),
    onSuccess: invalidateComments,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: invalidateComments,
  })

  const pending =
    addRootMutation.isPending ||
    addReplyMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending

  return (
    <div class="notes-section">
      <h3>Comments</h3>

      <CommentThread
        comments={commentsQuery.data ?? []}
        isLoading={commentsQuery.isLoading}
        onAddRoot={(content) => addRootMutation.mutate(content)}
        onAddReply={(rootId, content) => addReplyMutation.mutate({ content, rootId })}
        onEdit={(id, content) => updateMutation.mutate({ content, id })}
        onDelete={(id) => deleteMutation.mutate(id)}
        pending={pending}
      />
    </div>
  )
}
