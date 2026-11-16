import type { OfficialFeedResponse, PublicTagPost, PublicTagPostsResponse } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import {
  type ModerationAction,
  moderationOptions,
  removedByModeration,
} from '../../components/public-tag-moderation'
import { addPublicTagBlock, apiErrorMessage, hidePublicTagPost } from '../../state/api'
import './PublicTagModerationMenu.css'

const runAction = (postId: string, action: ModerationAction): Promise<unknown> =>
  action.kind === 'hide'
    ? hidePublicTagPost(postId)
    : addPublicTagBlock({ kind: action.kind, value: action.value })

/**
 * An admin's moderation buttons under a tag page post: hide it, block its author
 * or its domain. Each asks first, then drops the affected posts from the loaded
 * tag pages and official feed without a reload.
 */
export function PublicTagModerationMenu({ entry }: { entry: PublicTagPost }) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (action: ModerationAction) => {
    setPending(true)
    setError(null)
    try {
      await runAction(entry.id, action)
      const gone = (post: PublicTagPost) => removedByModeration(post, entry.id, action)
      queryClient.setQueriesData<InfiniteData<PublicTagPostsResponse>>({ queryKey: ['publicTag'] }, (data) =>
        data == null
          ? data
          : {
              ...data,
              pages: data.pages.map((page) => ({ ...page, posts: page.posts.filter((p) => !gone(p)) })),
            },
      )
      queryClient.setQueriesData<InfiniteData<OfficialFeedResponse>>({ queryKey: ['officialFeed'] }, (data) =>
        data == null
          ? data
          : {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                posts: page.posts.filter((p) => p.origin !== 'remote' || !gone(p)),
              })),
            },
      )
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not do that'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div class="tag-moderation">
      {moderationOptions(entry, window.location.hostname).map((option) => (
        <ConfirmButton
          key={option.label}
          label={option.label}
          confirmMessage={option.confirmMessage}
          confirmLabel={option.confirmLabel}
          onConfirm={() => confirm(option.action)}
          isPending={pending}
          buttonClass="tag-moderation-button"
        />
      ))}
      {error && <span class="tag-moderation-error">{error}</span>}
    </div>
  )
}
