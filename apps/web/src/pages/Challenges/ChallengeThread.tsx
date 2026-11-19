import type { ChallengeThreadResponse, PublicChallenge } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'preact/hooks'

import { fetchChallengeThread } from '../../state/api'
import { auth } from '../../state/auth'
import '../Feed/FeedPostCard.css'
import { allowedAudiences, composerHint, flattenThreadPages } from './challenge-thread-view'
import { ChallengeCommentComposer } from './ChallengeCommentComposer'
import { ChallengeThreadItem } from './ChallengeThreadEntry'

/** The prefix of every thread query of one challenge, signed in or not. */
export const challengeThreadKey = (username: string, slug: string) =>
  ['challengeThread', username, slug] as const

export function ChallengeThread({
  username,
  slug,
  challenge,
}: {
  username: string
  slug: string
  challenge: PublicChallenge
}) {
  const queryClient = useQueryClient()
  const isLoggedIn = Boolean(auth.value.token)
  const challengeUrl = challenge.share_url
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<
      ChallengeThreadResponse,
      Error,
      InfiniteData<ChallengeThreadResponse>,
      readonly string[],
      string | undefined
    >({
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: undefined,
      queryFn: ({ pageParam }) => fetchChallengeThread(username, slug, challengeUrl, pageParam),
      queryKey: [...challengeThreadKey(username, slug), isLoggedIn ? 'viewer' : 'public'],
    })

  const { entries, viewer } = flattenThreadPages(data?.pages)
  const hint = composerHint(isLoggedIn, viewer)
  const refresh = () => queryClient.invalidateQueries({ queryKey: challengeThreadKey(username, slug) })

  const sectionRef = useRef<HTMLElement>(null)
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || isLoading || window.location.hash !== '#comments') return
    scrolled.current = true
    sectionRef.current?.scrollIntoView()
  }, [isLoading])

  return (
    <section id="comments" class="challenge-thread" ref={sectionRef}>
      <h2>Comments</h2>
      {viewer?.can_comment && (
        <ChallengeCommentComposer
          challengeUrl={challengeUrl}
          allowed={allowedAudiences(viewer)}
          onPosted={() => void refresh()}
        />
      )}
      {hint === 'sign-in' && (
        <p class="public-muted">
          <a href={`/login?next=${encodeURIComponent(window.location.pathname)}`}>Sign in to comment</a>
        </p>
      )}
      {hint === 'members-only' && <p class="public-muted">Only people in the challenge can comment here.</p>}

      {isLoading ? (
        <p class="public-muted">Loading comments…</p>
      ) : isError ? (
        <p class="challenge-comment-error">{error.message}</p>
      ) : entries.length === 0 ? (
        <p class="public-muted">No comments yet.</p>
      ) : (
        <ul class="challenge-comment-list">
          {entries.map((entry) => (
            <ChallengeThreadItem
              key={entry.id}
              entry={entry}
              viewer={viewer}
              challengeUrl={challengeUrl}
              onChanged={() => void refresh()}
            />
          ))}
        </ul>
      )}
      {hasNextPage && (
        <button
          type="button"
          class="btn-secondary challenge-comment-more"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  )
}
