/**
 * Followed hashtags (#1540): following `#running` follows its tag actor
 * (`running@tags.pub` by default), which boosts every public post it sees with
 * the tag into the home timeline. Pending until the tag actor accepts.
 */
import type { FollowedTag } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchFollowedTags, followTag, unfollowTag } from '../../state/api'
import { TIMELINE_PAGES_KEY } from './TimelineActions'

const FOLLOWED_TAGS_KEY = ['followed-tags']

const FollowedTagRow = ({ row }: { row: FollowedTag }) => {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: FOLLOWED_TAGS_KEY })
  const unfollow = useMutation({
    mutationFn: () => unfollowTag(row.tag),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: TIMELINE_PAGES_KEY })
    },
  })

  return (
    <li class="following-row">
      <span class="following-ident">
        <span class="following-name">#{row.tag}</span>
        {row.handle && <span class="following-handle">{row.handle}</span>}
      </span>
      {!row.accepted && (
        <span class="following-pending" title="Awaiting the tag actor's acceptance">
          Pending
        </span>
      )}
      <button
        type="button"
        class="btn-secondary following-unfollow"
        onClick={() => unfollow.mutate()}
        disabled={unfollow.isPending}
      >
        {unfollow.isPending ? 'Unfollowing…' : 'Unfollow'}
      </button>
    </li>
  )
}

export function FollowedTagsPanel() {
  const queryClient = useQueryClient()
  const { data: tags, isLoading } = useQuery({ queryFn: fetchFollowedTags, queryKey: FOLLOWED_TAGS_KEY })
  const [tag, setTag] = useState('')

  const follow = useMutation({
    mutationFn: (t: string) => followTag(t),
    onSuccess: () => {
      setTag('')
      queryClient.invalidateQueries({ queryKey: FOLLOWED_TAGS_KEY })
    },
  })

  const onSubmit = (event: Event) => {
    event.preventDefault()
    const trimmed = tag.trim()
    if (trimmed) follow.mutate(trimmed)
  }

  return (
    <section class="following-panel">
      <h2 class="following-title">Followed tags</h2>
      <form class="following-form" onSubmit={onSubmit}>
        <input
          class="following-input"
          type="text"
          value={tag}
          onInput={(e) => setTag(e.currentTarget.value)}
          placeholder="#running"
          aria-label="Hashtag to follow"
          disabled={follow.isPending}
        />
        <button type="submit" class="btn-primary" disabled={follow.isPending || !tag.trim()}>
          {follow.isPending ? 'Following…' : 'Follow'}
        </button>
      </form>
      {follow.isError && (
        <p class="following-error">
          {follow.error instanceof Error && follow.error.message
            ? follow.error.message
            : "Couldn't follow that tag. Check it and try again."}
        </p>
      )}

      {isLoading && <p>Loading…</p>}
      {tags && tags.length === 0 && (
        <p class="following-empty">
          Follow a hashtag to see public posts carrying it from across the fediverse in your timeline.
        </p>
      )}
      {tags && tags.length > 0 && (
        <ul class="following-list">
          {tags.map((row) => (
            <FollowedTagRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}
