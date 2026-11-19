/**
 * PublicChallenge - read-only challenge view at /u/:username/:slug when the slug
 * resolves to a challenge. Shows a cumulative "race" chart (one line per member)
 * and a leaderboard, plus join actions. Rendered without app chrome for
 * anonymous visitors; logged-in viewers keep their nav (see AppShell).
 */
import type { PublicChallenge as PublicChallengeData } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchChallengeThread, fetchPublicChallengeStandings, joinChallengeByUrl } from '../../state/api'
import { auth } from '../../state/auth'
import { ChallengeThread, challengeThreadKey } from './ChallengeThread'
import { ChallengeView } from './ChallengeView'
import { joinPagePath } from './join-query'
import './style.css'

export function PublicChallenge({
  username,
  slug,
  challenge,
}: {
  username: string
  slug: string
  challenge: PublicChallengeData
}) {
  const queryClient = useQueryClient()
  const isLoggedIn = Boolean(auth.value.token)
  const isOwner = isLoggedIn && auth.value.user === username
  const [joined, setJoined] = useState(false)

  const standingsQuery = useQuery({
    queryFn: () => fetchPublicChallengeStandings(username, slug),
    queryKey: ['challengeStandings', username, slug],
    staleTime: 60 * 1000,
  })

  const joinMutation = useMutation({
    mutationFn: () => joinChallengeByUrl(challenge.share_url),
    onError: (e) => alert(e instanceof Error ? e.message : 'Failed to join.'),
    onSuccess: async () => {
      setJoined(true)
      void queryClient.invalidateQueries({ queryKey: challengeThreadKey(username, slug) })
      // Refetch with the cache buster so the just-joined member shows up immediately
      // (a plain refetch can be served the pre-join list from the endpoint's 60s HTTP
      // cache), and seed the query cache with the fresh result so no stale refetch races.
      const fresh = await fetchPublicChallengeStandings(username, slug, { bustCache: true })
      queryClient.setQueryData(['challengeStandings', username, slug], fresh)
    },
  })

  const joinFromOtherHost = () => {
    const host = window.prompt('Enter your Aurboda host (e.g. https://aurboda.net):')?.trim()
    if (!host) return
    const base = host.startsWith('http') ? host : `https://${host}`
    window.location.href = `${base.replace(/\/+$/, '')}${joinPagePath(challenge.share_url, false)}`
  }

  return (
    <div class="dashboard public-dashboard public-challenge">
      <ChallengeView
        challenge={challenge}
        standings={standingsQuery.data}
        loading={standingsQuery.isLoading}
        attribution={
          <a class="public-attribution" href={`/u/${encodeURIComponent(username)}`}>
            @{username}
          </a>
        }
        actions={
          <>
            {isLoggedIn && !isOwner && !joined && (
              <button
                class="btn-primary"
                disabled={joinMutation.isPending}
                onClick={() => joinMutation.mutate()}
              >
                Join
              </button>
            )}
            {joined && <span class="challenge-joined">✓ Joined</span>}
            <button class="btn-secondary" onClick={joinFromOtherHost}>
              Join from another instance
            </button>
            {isOwner && (
              <a class="btn-secondary" href="/challenges">
                Manage
              </a>
            )}
          </>
        }
      />

      <ChallengeThread
        challengeUrl={challenge.share_url}
        queryKey={[...challengeThreadKey(username, slug), isLoggedIn ? 'viewer' : 'public']}
        fetchPage={(cursor) => fetchChallengeThread(username, slug, challenge.share_url, cursor)}
      />
    </div>
  )
}
