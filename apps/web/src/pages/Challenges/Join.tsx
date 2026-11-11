/**
 * ChallengeJoin - /challenges/join?challenge=<url>[&confirm=1]. Runs join-by-URL on
 * this (the user's own) instance, then redirects to the challenge. This is where the
 * "join from another instance" flow lands after redirecting from a host, joining on
 * load; with `confirm=1` (the Android widget's suggestion) it shows the challenge
 * first, joins on the Join click and stays on this instance (see `confirmedJoinTarget`).
 */
import type { ChallengePreview } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useRef } from 'preact/hooks'

import { apiErrorMessage, joinChallengeByUrl, previewChallenge } from '../../state/api'
import { auth } from '../../state/auth'
import { confirmedJoinTarget, hostProfileUrl, joinPagePath, parseJoinQuery } from './join-query'
import { formatChallengeWindow } from './race-series'
import { describeSpec } from './spec-label'
import './style.css'

const errorText = (error: unknown, fallback: string): string =>
  apiErrorMessage(error, error instanceof Error ? error.message : fallback)

export function ChallengeJoin() {
  const { query } = useLocation()
  const { challengeUrl, confirm, safeChallengeUrl } = parseJoinQuery(query)
  const isLoggedIn = Boolean(auth.value.token)
  const started = useRef(false)

  const previewQuery = useQuery({
    enabled: isLoggedIn && confirm && Boolean(challengeUrl),
    queryFn: () => previewChallenge(challengeUrl),
    queryKey: ['challengePreview', challengeUrl],
    retry: false,
  })

  const joinMutation = useMutation({
    mutationFn: () => joinChallengeByUrl(challengeUrl),
    onSuccess: () => {
      window.location.href = confirm
        ? confirmedJoinTarget(previewQuery.data?.share_url ?? challengeUrl, window.location.origin)
        : (safeChallengeUrl ?? '/challenges')
    },
  })

  useEffect(() => {
    if (isLoggedIn && challengeUrl && !confirm && !started.current) {
      started.current = true
      joinMutation.mutate()
    }
  }, [isLoggedIn, challengeUrl, confirm])

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
          Please <a href={`/login?next=${encodeURIComponent(joinPagePath(challengeUrl, confirm))}`}>log in</a>{' '}
          to join this challenge on your instance.
        </p>
      </div>
    )
  }

  const joinError = joinMutation.isError && (
    <p class="challenges-empty">
      {errorText(joinMutation.error, 'Failed to join.')}{' '}
      {safeChallengeUrl && <a href={safeChallengeUrl}>Open the challenge</a>}
    </p>
  )

  if (!confirm) {
    return (
      <div class="challenges-page">
        <h1>Joining challenge…</h1>
        {joinError}
        {!joinMutation.isError && (
          <p class="public-muted">Setting things up, you’ll be redirected shortly…</p>
        )}
      </div>
    )
  }

  if (!previewQuery.data) {
    return (
      <div class="challenges-page">
        <h1>Join a challenge</h1>
        {previewQuery.isError ? (
          <p class="challenges-empty">
            {errorText(previewQuery.error, 'Could not read this challenge.')}{' '}
            {safeChallengeUrl && <a href={safeChallengeUrl}>Open the challenge</a>}
          </p>
        ) : (
          <p class="public-muted">Loading the challenge…</p>
        )}
      </div>
    )
  }

  return (
    <ChallengeJoinConfirm
      challenge={previewQuery.data}
      joinError={joinError}
      joining={joinMutation.isPending || joinMutation.isSuccess}
      onJoin={() => joinMutation.mutate()}
      safeChallengeUrl={safeChallengeUrl}
    />
  )
}

function ChallengeJoinConfirm({
  challenge,
  joinError,
  joining,
  onJoin,
  safeChallengeUrl,
}: {
  challenge: ChallengePreview
  joinError: ComponentChildren
  joining: boolean
  onJoin: () => void
  safeChallengeUrl: string | null
}) {
  const hostUrl = hostProfileUrl(challenge.share_url)
  return (
    <div class="challenges-page challenge-join-confirm">
      <h1>{challenge.name}</h1>
      <p>Hosted by {hostUrl ? <a href={hostUrl}>{challenge.host_handle}</a> : challenge.host_handle}</p>
      <p class="challenge-view-meta">
        {describeSpec(challenge.spec)} ({challenge.spec.unit}) ·{' '}
        {formatChallengeWindow(challenge.start_ts, challenge.end_ts, challenge.timezone)}
      </p>
      <div class="challenge-view-actions">
        <button class="btn-primary" disabled={joining} onClick={onJoin}>
          {joining ? 'Joining…' : 'Join'}
        </button>
        {safeChallengeUrl && (
          <a class="btn-secondary" href={safeChallengeUrl}>
            View challenge
          </a>
        )}
      </div>
      {joinError}
    </div>
  )
}
