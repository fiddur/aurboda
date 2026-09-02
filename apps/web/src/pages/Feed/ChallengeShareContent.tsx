/**
 * Native body for a challenge-share post (#994): the challenge name, the
 * author's markdown note (rendered through the shared sanitiser — #910), and
 * the canonical join-by-URL link. Mirrors the federated Note's content, so the
 * owner's card shows what followers see.
 *
 * A completion post (the host instance's automatic winner announcement) carries
 * a frozen `result`: the podium is rendered under a "has finished" heading, the
 * winner(s) linked to their profile — the same people the federated Note tags.
 */
import type { ChallengeResult, ChallengeShare } from '@aurboda/api-spec'

import { renderMarkdown } from '../../utils/markdown'
import { podiumMedal } from '../../utils/podium'

const ChallengeResultPodium = ({ result }: { result: ChallengeResult }) => (
  <div class="challenge-podium">
    <ol class="challenge-podium-list">
      {result.podium.map((entry) => (
        <li
          key={entry.identity_base_url}
          class={`challenge-podium-entry challenge-podium-rank-${entry.rank}`}
        >
          <span class="challenge-podium-medal" aria-hidden="true">
            {podiumMedal(entry.rank) ?? `#${entry.rank}`}
          </span>
          <a
            class="challenge-podium-name"
            href={entry.identity_base_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {entry.rank === 1 ? `@${entry.display_name}` : entry.display_name}
          </a>
          <span class="challenge-podium-total">
            {Math.round(entry.total).toLocaleString()} {result.unit}
          </span>
        </li>
      ))}
    </ol>
    <p class="challenge-podium-count">
      {result.member_count} {result.member_count === 1 ? 'member' : 'members'} competed
    </p>
  </div>
)

export const ChallengeShareContent = ({
  challenge,
  message,
}: {
  challenge: ChallengeShare
  message?: string
}) => (
  <div class="feed-post-content">
    <p class="feed-post-title">
      <strong>{challenge.name}</strong>
      {challenge.result && ' has finished! 🏁'}
    </p>
    {challenge.result && <ChallengeResultPodium result={challenge.result} />}
    {message && <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message) }} />}
    <p>
      <a href={challenge.url} target="_blank" rel="noopener noreferrer">
        {challenge.url}
      </a>
    </p>
  </div>
)
