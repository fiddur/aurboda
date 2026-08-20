/**
 * Native body for a challenge-share post (#994): the challenge name, the
 * author's markdown note (rendered through the shared sanitiser — #910), and
 * the canonical join-by-URL link. Mirrors the federated Note's content, so the
 * owner's card shows what followers see.
 */
import type { ChallengeShare } from '@aurboda/api-spec'

import { renderMarkdown } from '../../utils/markdown'

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
    </p>
    {message && <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message) }} />}
    <p>
      <a href={challenge.url} target="_blank" rel="noopener noreferrer">
        {challenge.url}
      </a>
    </p>
  </div>
)
