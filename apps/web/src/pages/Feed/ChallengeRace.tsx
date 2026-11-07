/**
 * The race card a challenge shows in the feed: its spec line, the cumulative
 * race chart, the leaderboard and the link to the live challenge page (where
 * the join flow is). Shared by a challenge-share post (`TimelineChallenge`) and
 * an article's challenge block (`ArticleChallengeBlock`); the data comes in as
 * a `ChallengeRaceView` (`challenge-race-view.ts`), whatever its source.
 */
import type { ChallengeRaceView } from './challenge-race-view'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { memberColor } from '../Challenges/member-colors'
import { formatUpdated } from '../Challenges/race-series'
import '../Challenges/style.css'
import './FeedPostCard.css'
import './TimelineStructured.css'

export const ChallengeRace = ({ view }: { view: ChallengeRaceView }) => (
  <>
    <p class="timeline-challenge-spec">{view.specLabel}</p>
    {view.series.length > 0 ? (
      <div class="timeline-chart">
        <TrendLineChart
          data={[]}
          color={memberColor(0)}
          multiSeries={view.series}
          height={280}
          xDomain={view.xDomain}
        />
      </div>
    ) : (
      <p class="public-muted">No standings yet.</p>
    )}
    {view.rows.length > 0 && (
      <table class="challenge-leaderboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Member</th>
            <th>{view.totalHeader}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row, i) => (
            <tr key={row.key}>
              <td>{row.rank}</td>
              <td>
                <span
                  aria-hidden="true"
                  class="challenge-member-color"
                  style={{ background: memberColor(i) }}
                />
                {row.name}
                {row.stale && <span class="challenge-member-updated"> ⚠ stale</span>}
              </td>
              <td>{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {view.asOf && <p class="timeline-challenge-asof">Standings as of {formatUpdated(view.asOf)}</p>}
    {view.link && (
      <p>
        <a href={view.link} target="_blank" rel="noopener noreferrer">
          Join / view challenge
        </a>
      </p>
    )}
  </>
)
