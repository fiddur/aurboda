/**
 * Native timeline card for a challenge-share post from an Aurboda peer (#994):
 * the race chart and leaderboard the live challenge page shows, drawn from the
 * standings snapshot the payload carried at ingest — hence the "as of" line and
 * the link to the live page. The note is the remote author's markdown, so it
 * goes through `renderRemoteMarkdown` (untrusted, no `<img>`).
 */
import type { FeedStructuredChallenge } from '@aurboda/api-spec'

import { useMemo } from 'preact/hooks'

import { renderRemoteMarkdown } from '../../utils/markdown'
import { structuredRaceView } from './challenge-race-view'
import { ChallengeRace } from './ChallengeRace'
import { ChallengeResultPodium } from './ChallengeShareContent'

export const TimelineChallenge = ({ structured }: { structured: FeedStructuredChallenge }) => {
  const { message, result } = structured
  const view = useMemo(() => structuredRaceView(structured), [structured])

  return (
    <div class="timeline-structured timeline-challenge">
      <p class="feed-post-title">
        <strong>
          {view.link ? (
            <a href={view.link} target="_blank" rel="noopener noreferrer">
              {view.name}
            </a>
          ) : (
            view.name
          )}
        </strong>
        {result && ' has finished! 🏁'}
      </p>
      {result && <ChallengeResultPodium result={result} />}
      {message && <div dangerouslySetInnerHTML={{ __html: renderRemoteMarkdown(message) }} />}
      <ChallengeRace view={view} />
    </div>
  )
}
