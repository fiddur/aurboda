/**
 * ChallengeJoin - /challenges/join?challenge=<url>. Runs join-by-URL on this
 * (the user's own) instance, then redirects to the challenge. This is where the
 * "join from another instance" flow lands after redirecting from a host.
 */
import { useMutation } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useRef } from 'preact/hooks'

import { joinChallengeByUrl } from '../../state/api'
import { auth } from '../../state/auth'

export function ChallengeJoin() {
  const { query } = useLocation()
  const challengeUrl = typeof query.challenge === 'string' ? query.challenge : ''
  const isLoggedIn = Boolean(auth.value.token)
  const started = useRef(false)

  const joinMutation = useMutation({
    mutationFn: () => joinChallengeByUrl(challengeUrl),
    onSuccess: () => {
      // Only follow http(s) targets (defense-in-depth; the join already validated it).
      window.location.href = /^https?:\/\//.test(challengeUrl) ? challengeUrl : '/challenges'
    },
  })

  useEffect(() => {
    if (isLoggedIn && challengeUrl && !started.current) {
      started.current = true
      joinMutation.mutate()
    }
  }, [isLoggedIn, challengeUrl])

  if (!challengeUrl) {
    return (
      <div class="challenges-page">
        <h1>Join a challenge</h1>
        <p class="public-muted">No challenge URL was provided.</p>
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div class="challenges-page">
        <h1>Join a challenge</h1>
        <p>
          Please{' '}
          <a href={`/login?next=${encodeURIComponent(`/challenges/join?challenge=${encodeURIComponent(challengeUrl)}`)}`}>
            log in
          </a>{' '}
          to join this challenge on your instance.
        </p>
      </div>
    )
  }

  return (
    <div class="challenges-page">
      <h1>Joining challenge…</h1>
      {joinMutation.isError && (
        <p class="challenges-empty">
          {joinMutation.error instanceof Error ? joinMutation.error.message : 'Failed to join.'}{' '}
          <a href={challengeUrl}>Open the challenge</a>
        </p>
      )}
      {!joinMutation.isError && <p class="public-muted">Setting things up, you’ll be redirected shortly…</p>}
    </div>
  )
}
