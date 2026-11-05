import type { ShareVisibility } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { CopyLinkButton, GlobeIcon, NativeShareButton, ShareArrowIcon } from '../../components/ShareControls'
import { ShareExerciseDialog } from '../../components/ShareExerciseDialog'
import { SHARE_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import {
  apiErrorMessage,
  deleteSharedExercise,
  listSharedExercises,
  updateSharedExercise,
} from '../../state/api'
import { PublishExerciseDialog } from './PublishExerciseDialog'

const QUERY_KEY = ['sharedExercises']

/**
 * The exercise's sharing verbs: publish its progress at a public page (or manage the published page),
 * and post it to the feed.
 */
export const ShareExercise = ({ name, field, value }: { name: string; field: string; value: string }) => {
  const queryClient = useQueryClient()
  const [publishing, setPublishing] = useState(false)
  const [sharingToFeed, setSharingToFeed] = useState(false)
  const query = useQuery({ queryFn: listSharedExercises, queryKey: QUERY_KEY, staleTime: 60 * 1000 })
  const share = query.data?.find((e) => e.activity_type === name && e.field === field && e.value === value)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  const update = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: ShareVisibility }) =>
      updateSharedExercise(id, { visibility }),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: deleteSharedExercise, onSuccess: invalidate })
  const failed = update.error ?? remove.error

  if (query.isLoading || query.isError) return null

  const shareToFeedButton = (
    <button
      type="button"
      class="icon-button"
      aria-label="Share to feed"
      title="Share to feed"
      onClick={() => setSharingToFeed(true)}
    >
      <ShareArrowIcon />
    </button>
  )

  return (
    <div class="activity-type-item-share">
      {share ? (
        <>
          <span class="activity-type-item-published">
            <GlobeIcon />
            Published
          </span>
          <VisibilitySelector
            compact
            name={`exercise-visibility-${share.id}`}
            options={SHARE_VISIBILITY_OPTIONS}
            value={share.visibility}
            onChange={(visibility) => update.mutate({ id: share.id, visibility })}
          />
          <a href={share.share_url} target="_blank" rel="noopener noreferrer">
            Open page
          </a>
          <CopyLinkButton url={share.share_url} />
          <NativeShareButton url={share.share_url} title={`${share.name} — Aurboda`} />
          {shareToFeedButton}
          <button
            type="button"
            class="activity-type-item-share-stop"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`Unpublish ${share.name}? Its link will stop working.`)) remove.mutate(share.id)
            }}
          >
            Unpublish
          </button>
        </>
      ) : (
        <>
          {shareToFeedButton}
          <button
            type="button"
            class="activity-type-item-publish"
            title="Publish a public page for this exercise"
            onClick={() => setPublishing(true)}
          >
            <GlobeIcon />
            Publish
          </button>
        </>
      )}
      {publishing && (
        <PublishExerciseDialog
          activityType={name}
          field={field}
          value={value}
          onClose={() => setPublishing(false)}
        />
      )}
      {sharingToFeed && (
        <ShareExerciseDialog
          activityType={name}
          field={field}
          value={value}
          publishedUrl={share?.share_url}
          onClose={() => setSharingToFeed(false)}
        />
      )}
      {failed && <p class="error">{apiErrorMessage(failed, 'Failed to update the published page')}</p>}
    </div>
  )
}
