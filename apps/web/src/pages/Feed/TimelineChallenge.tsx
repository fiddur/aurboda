/**
 * Native timeline card for a challenge-share post from an Aurboda peer (#994):
 * the race chart and leaderboard the live challenge page shows, drawn from the
 * standings snapshot the payload carried at ingest — hence the "as of" line and
 * the link to the live page. The note is the remote author's markdown, so it
 * goes through `renderRemoteMarkdown` (untrusted, no `<img>`).
 */
import type { FeedStructuredChallenge } from '@aurboda/api-spec'

import { useMemo } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { renderRemoteMarkdown } from '../../utils/markdown'
import { memberColor } from '../Challenges/member-colors'
import { formatUpdated } from '../Challenges/race-series'
import { describeSpec, totalHeader } from '../Challenges/spec-label'
import { ChallengeResultPodium } from './ChallengeShareContent'
import { formatStandingTotal, standingsRaceSeries } from './timeline-challenge'
import '../Challenges/style.css'
import './FeedPostCard.css'
import './TimelineStructured.css'

export const TimelineChallenge = ({ structured }: { structured: FeedStructuredChallenge }) => {
  const { challenge, message, result, standings } = structured
  const spec = challenge.aurboda?.spec
  const series = useMemo(() => standingsRaceSeries(structured), [structured])
  const members = standings?.members ?? []

  return (
    <div class="timeline-structured timeline-challenge">
      <p class="feed-post-title">
        <strong>
          <a href={challenge.url} target="_blank" rel="noopener noreferrer">
            {challenge.name}
          </a>
        </strong>
        {result && ' has finished! 🏁'}
      </p>
      {result && <ChallengeResultPodium result={result} />}
      {message && <div dangerouslySetInnerHTML={{ __html: renderRemoteMarkdown(message) }} />}
      <p class="timeline-challenge-spec">
        {spec ? describeSpec(spec) : `${challenge.metric} · ${challenge.scoring}`}
      </p>
      {series.length > 0 ? (
        <div class="timeline-chart">
          <TrendLineChart
            data={[]}
            color={memberColor(0)}
            multiSeries={series}
            height={280}
            xDomain={[new Date(challenge.startTime), new Date(new Date(challenge.endTime).getTime() - 1)]}
          />
        </div>
      ) : (
        <p class="public-muted">No standings yet.</p>
      )}
      {members.length > 0 && (
        <table class="challenge-leaderboard">
          <thead>
            <tr>
              <th>#</th>
              <th>Member</th>
              <th>{spec ? totalHeader(spec) : 'Total'}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, i) => (
              <tr key={member.url}>
                <td>{member.rank}</td>
                <td>
                  <span
                    aria-hidden="true"
                    class="challenge-member-color"
                    style={{ background: memberColor(i) }}
                  />
                  {member.name}
                  {member.stale && <span class="challenge-member-updated"> ⚠ stale</span>}
                </td>
                <td>{formatStandingTotal(structured, member.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {standings && <p class="timeline-challenge-asof">Standings as of {formatUpdated(standings.asOf)}</p>}
      <p>
        <a href={challenge.url} target="_blank" rel="noopener noreferrer">
          Join / view challenge
        </a>
      </p>
    </div>
  )
}
