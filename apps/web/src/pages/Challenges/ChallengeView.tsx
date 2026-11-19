import type { ChallengeStanding, PublicChallenge } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { useMemo } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { competitionRanks, podiumMedal } from '../../utils/podium'
import { memberColor } from './member-colors'
import { formatChallengeWindow, formatUpdated, toCumulativeSeries } from './race-series'
import { describeSpec, formatTotal, totalHeader } from './spec-label'
import './style.css'

const shortHost = (identityBaseUrl: string): string => {
  try {
    return new URL(identityBaseUrl).host
  } catch {
    return identityBaseUrl
  }
}

/** A challenge's banner, header, race chart and leaderboard, on its host's page and on a member's own server. */
export function ChallengeView({
  challenge,
  standings: allStandings,
  loading,
  attribution,
  actions,
}: {
  challenge: PublicChallenge
  standings: ChallengeStanding[] | undefined
  loading: boolean
  attribution: ComponentChildren
  actions: ComponentChildren
}) {
  const standings = (allStandings ?? []).filter((s) => s.status === 'active')
  // Once the window has closed, medal the podium (equal totals share a rank) like
  // the host's completion post and the Android widget do. It is provisional until
  // the host's announcement freezes it (grace period, up to 24 h with a stale
  // member) — late-syncing last-day data can still reorder it (#1076).
  const ended = Date.now() >= new Date(challenge.end_ts).getTime()
  const ranks = competitionRanks(standings.map((s) => s.total))
  const { start_ts, effective_bucket_size, spec } = challenge
  const series = useMemo(
    () =>
      (allStandings ?? [])
        .filter((s) => s.status === 'active')
        // Falls back to daily if a cross-version host omits the resolved bucket size.
        .map((s, i) =>
          toCumulativeSeries(s, memberColor(i), start_ts, effective_bucket_size ?? '1d', spec.aggregation),
        )
        // Keep members with at least one real bucket (the start-line point alone is length 1).
        .filter((s) => s.data.length > 1),
    [allStandings, start_ts, effective_bucket_size, spec.aggregation],
  )

  return (
    <>
      {challenge.banner_url && <img class="challenge-banner" src={challenge.banner_url} alt="" />}
      <div class="dashboard-header">
        <h1>{challenge.name}</h1>
        {attribution}
      </div>

      <p class="challenge-view-meta">
        {describeSpec(spec)} ({spec.unit}) ·{' '}
        {formatChallengeWindow(challenge.start_ts, challenge.end_ts, challenge.timezone)}
      </p>

      <div class="challenge-view-actions">{actions}</div>

      <div class="challenge-race-chart">
        {loading ? (
          <div class="public-loading">Loading standings…</div>
        ) : series.length > 0 ? (
          <TrendLineChart
            data={[]}
            color={memberColor(0)}
            multiSeries={series}
            height={280}
            // end_ts is the exclusive window end (midnight after the last day); step back
            // one ms so the axis ends on the inclusive last competing day (matching the
            // header) rather than drawing a trailing tick on the day after.
            xDomain={[new Date(challenge.start_ts), new Date(new Date(challenge.end_ts).getTime() - 1)]}
          />
        ) : (
          <p class="public-muted">No data yet.</p>
        )}
      </div>

      {ended && standings.some((s) => s.total > 0) && (
        <p class="challenge-final">🏁 Finished — standings settle once the host has announced the result</p>
      )}
      <table class="challenge-leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Member</th>
            <th>{totalHeader(spec)}</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr
              key={s.identity_base_url}
              class={ended && ranks[i] === 1 && s.total > 0 ? 'challenge-winner' : ''}
            >
              <td>
                {ended && s.total > 0 && podiumMedal(ranks[i]) ? (
                  <span title={`#${ranks[i]}`}>{podiumMedal(ranks[i])}</span>
                ) : (
                  ranks[i]
                )}
              </td>
              <td>
                <span
                  aria-hidden="true"
                  class="challenge-member-color"
                  style={{ background: memberColor(i) }}
                />
                {s.display_name} <span class="challenge-member-host">· {shortHost(s.identity_base_url)}</span>
              </td>
              <td>{formatTotal(spec, s.total)}</td>
              <td class="challenge-member-updated">
                {s.stale ? '⚠ stale' : s.last_updated ? formatUpdated(s.last_updated) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
