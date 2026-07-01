/**
 * PublicChallenge - read-only challenge view at /u/:username/:slug when the slug
 * resolves to a challenge. Shows a cumulative "race" chart (one line per member)
 * and a leaderboard, plus join actions. Rendered without app chrome.
 */
import type { ChallengeStanding, PublicChallenge as PublicChallengeData } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { type LineSeriesData, TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchPublicChallengeStandings, joinChallengeByUrl } from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a855f7']

/** Build a cumulative (running-total) series from a member's per-bucket values. */
const toCumulativeSeries = (standing: ChallengeStanding, color: string): LineSeriesData => {
  const sorted = [...standing.buckets].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start))
  let running = 0
  return {
    color,
    data: sorted.map((b) => {
      running += b.value
      return { date: b.bucket_start, value: running }
    }),
    name: standing.display_name,
  }
}

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

  const standingsQuery = useQuery({
    queryFn: () => fetchPublicChallengeStandings(username, slug),
    queryKey: ['challengeStandings', username, slug],
    staleTime: 60 * 1000,
  })

  const joinMutation = useMutation({
    mutationFn: () => joinChallengeByUrl(challenge.share_url),
    onError: (e) => alert(e instanceof Error ? e.message : 'Failed to join.'),
    onSuccess: () => {
      alert('Joined!')
      queryClient.invalidateQueries({ queryKey: ['challengeStandings', username, slug] })
    },
  })

  const joinFromOtherHost = () => {
    const host = window.prompt('Enter your Aurboda host (e.g. https://aurboda.net):')?.trim()
    if (!host) return
    const base = host.startsWith('http') ? host : `https://${host}`
    window.location.href = `${base.replace(/\/+$/, '')}/challenges/join?challenge=${encodeURIComponent(challenge.share_url)}`
  }

  const standings = standingsQuery.data ?? []
  const series = standings
    .filter((s) => s.status === 'active')
    .map((s, i) => toCumulativeSeries(s, COLORS[i % COLORS.length]))
    .filter((s) => s.data.length > 0)

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
        {new Date(challenge.start_ts).toLocaleDateString()} – {new Date(challenge.end_ts).toLocaleDateString()}
      </p>

      <div class="challenge-view-actions">
        {isLoggedIn && !isOwner && (
          <button class="btn-primary" disabled={joinMutation.isPending} onClick={() => joinMutation.mutate()}>
            Join
          </button>
        )}
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
