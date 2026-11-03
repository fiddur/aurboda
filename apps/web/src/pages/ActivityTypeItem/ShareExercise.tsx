import type { ShareVisibility } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ShareLinkButton } from '../../components/ShareLinkButton'
import { SHARE_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import {
  apiErrorMessage,
  createSharedExercise,
  deleteSharedExercise,
  listSharedExercises,
  updateSharedExercise,
} from '../../state/api'

const QUERY_KEY = ['sharedExercises']

/** Shares this exercise's progress at a public link, or shows the existing share's link and visibility. */
export const ShareExercise = ({ name, field, value }: { name: string; field: string; value: string }) => {
  const queryClient = useQueryClient()
  const query = useQuery({ queryFn: listSharedExercises, queryKey: QUERY_KEY, staleTime: 60 * 1000 })
  const share = query.data?.find((e) => e.activity_type === name && e.field === field && e.value === value)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  const create = useMutation({
    mutationFn: () => createSharedExercise({ activity_type: name, field, value, visibility: 'unlisted' }),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: ShareVisibility }) =>
      updateSharedExercise(id, { visibility }),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: deleteSharedExercise, onSuccess: invalidate })
  const failed = create.error ?? update.error ?? remove.error

  if (query.isLoading || query.isError) return null

  return (
    <div class="activity-type-item-share">
      {share ? (
        <>
          <a href={share.share_url} target="_blank" rel="noopener noreferrer">
            Shared page
          </a>
          <ShareLinkButton url={share.share_url} title={`${share.name} — Aurboda`} />
          <VisibilitySelector
            compact
            name={`exercise-visibility-${share.id}`}
            options={SHARE_VISIBILITY_OPTIONS}
            value={share.visibility}
            onChange={(visibility) => update.mutate({ id: share.id, visibility })}
          />
          <button
            type="button"
            class="activity-type-item-share-stop"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`Stop sharing ${share.name}? Its link will stop working.`)) remove.mutate(share.id)
            }}
          >
            Stop sharing
          </button>
        </>
      ) : (
        <button
          type="button"
          class="activity-type-item-share-open"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Share
        </button>
      )}
      {failed && <p class="error">{apiErrorMessage(failed, 'Failed to update the share')}</p>}
    </div>
  )
}
