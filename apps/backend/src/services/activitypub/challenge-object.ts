/**
 * The AS2 `content` for a challenge-share post (#994): the challenge name as a
 * bold heading, the author's personal note rendered from markdown through the
 * same outbound sanitiser as article prose (`renderProse` — #910's boundary),
 * and the challenge's canonical public URL as a plain link. Mastodon renders
 * the link with the challenge page's existing OG preview card; anyone joining
 * follows the normal public-page / join-by-URL flow. No attachments and no
 * standings data in phase 1.
 */
import type { ChallengeShare } from '@aurboda/api-spec'

import { renderProse } from './article-object.ts'
import { escapeXml } from '../charts/chart-svg.ts'

/** The Note `content` HTML for a challenge share. `message` is authored markdown. */
export const renderChallengeShareHtml = (challenge: ChallengeShare, message: string | null): string => {
  const parts = [`<p><strong>${escapeXml(challenge.name)}</strong></p>`]
  if (message) parts.push(renderProse(message))
  parts.push(
    `<p><a href="${escapeXml(challenge.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeXml(challenge.url)}</a></p>`,
  )
  return parts.join('\n')
}
