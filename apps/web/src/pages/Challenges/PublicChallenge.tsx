/**
 * PublicChallenge - read-only challenge view at /u/:username/:slug when the slug
 * resolves to a challenge. Shows a cumulative "race" chart (one line per member)
 * and a leaderboard, plus join actions. Rendered without app chrome.
 */
import type { PublicChallenge as PublicChallengeData } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchPublicChallengeStandings, joinChallengeByUrl } from '../../state/api'
import { auth } from '../../state/auth'
import { formatDateInZone, toCumulativeSeries } from './race-series'
import './style.css'

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a855f7']

const shortHost = (identityBaseUrl: string): string => {
  try {
    return new URL(identityBaseUrl).host
  } catch {
    return identityBaseUrl
  }
}

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
    window.location.href = `${base.replace(/\/+$/, '')}/challenges/join?challenge=${encodeURIComponent(challenge.share_url)}`
  }

  const standings = (standingsQuery.data ?? []).filter((s) => s.status === 'active')
  const series = standings
    .map((s, i) => toCumulativeSeries(s, COLORS[i % COLORS.length], challenge.start_ts, challenge.spec.bucket_size))
    // Keep members with at least one real bucket (the start-line point alone is length 1).
    .filter((s) => s.data.length > 1)

  return (
    <div class="dashboard public-dashboard public-challenge">
      <div class="dashboard-header">
        <h1>{challenge.name}</h1>
        <a class="public-attribution" href={`/u/${encodeURIComponent(username)}`}>
          @{username}
        </a>
      </div>

      <p class="challenge-view-meta">
        {challenge.spec.pattern} · {challenge.spec.aggregation} ({challenge.spec.unit}) ·{' '}
        {/* Render both dates in the timezone the range was chosen in, so they read
            exactly as entered regardless of the viewer's browser locale/timezone. */}
        {formatDateInZone(challenge.start_ts, challenge.timezone)} –{' '}
        {/* end_ts is the exclusive window end (midnight after the last day); step back
            one ms to render the inclusive last competing day. */}
        {formatDateInZone(new Date(new Date(challenge.end_ts).getTime() - 1).toISOString(), challenge.timezone)}
      </p>

      <div class="challenge-view-actions">
        {isLoggedIn && !isOwner && !joined && (
          <button class="btn-primary" disabled={joinMutation.isPending} onClick={() => joinMutation.mutate()}>
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
      </div>

      <div class="challenge-race-chart">
        {standingsQuery.isLoading ? (
          <div class="public-loading">Loading standings…</div>
        ) : series.length > 0 ? (
          <TrendLineChart data={[]} color={COLORS[0]} multiSeries={series} height={280} />
        ) : (
          <p class="public-muted">No data yet.</p>
        )}
      </div>

      <table class="challenge-leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Member</th>
            <th>{challenge.spec.unit}</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr key={s.identity_base_url}>
              <td>{i + 1}</td>
              <td>
                {s.display_name} <span class="challenge-member-host">· {shortHost(s.identity_base_url)}</span>
              </td>
              <td>{Math.round(s.total).toLocaleString()}</td>
              <td class="challenge-member-updated">
                {s.stale ? '⚠ stale' : s.last_updated ? new Date(s.last_updated).toLocaleTimeString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
