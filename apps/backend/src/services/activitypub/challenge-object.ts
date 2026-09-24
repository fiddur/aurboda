/**
 * The AS2 `content` for a challenge-share post (#994): the challenge name as a
 * bold heading, the author's personal note rendered from markdown through the
 * same outbound sanitiser as article prose (`renderProse` — #910's boundary),
 * and the challenge's canonical public URL as a plain link. Mastodon renders
 * the link with the challenge page's existing OG preview card; anyone joining
 * follows the normal public-page / join-by-URL flow. No attachments and no
 * standings data on an invitation.
 *
 * A **completion post** (the host instance's automatic winner announcement)
 * carries a frozen `result`: the podium is rendered below the heading, with
 * each winner as a Mastodon-style mention link (`h-card` / `u-url mention`)
 * matching the `Mention` tag the Note carries, so the winner's server links
 * and notifies them.
 */
import type { ChallengeResult, ChallengeResultEntry, ChallengeShare } from '@aurboda/api-spec'

import { challengeWinners } from '../challenge-results.ts'
import { escapeXml } from '../charts/chart-svg.ts'
import { renderProse } from './article-object.ts'

const profileSegments = (identityBaseUrl: string): { url: URL; base: string[]; username: string } | null => {
  let url: URL
  try {
    url = new URL(identityBaseUrl)
  } catch {
    return null
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2 || segments[segments.length - 2] !== 'u') return null
  return { base: segments.slice(0, -2), url, username: segments[segments.length - 1] }
}

/**
 * A member identity (`https://host[/sub]/u/alice`) → the webfinger-style handle
 * `alice@host` (no leading `@`). Null when the URL is not a profile URL.
 */
export const identityToHandle = (identityBaseUrl: string): string | null => {
  const parsed = profileSegments(identityBaseUrl)
  if (parsed == null) return null
  try {
    return `${decodeURIComponent(parsed.username)}@${parsed.url.host}`
  } catch {
    return null
  }
}

/**
 * A member identity (`https://host[/sub]/u/alice`) → that member's ActivityPub
 * actor id (`https://host[/sub]/users/alice`), the URI a `Mention` must point at
 * (see `federation.ts`, which serves actors under `/users/`). Every challenge
 * member is on an Aurboda instance, so the mapping is exact.
 */
export const identityToActorUri = (identityBaseUrl: string): string | null => {
  const parsed = profileSegments(identityBaseUrl)
  if (parsed == null) return null
  const url = new URL(parsed.url.href)
  url.pathname = `/${[...parsed.base, 'users', parsed.username].join('/')}`
  url.search = ''
  url.hash = ''
  return url.href
}

const medal = (rank: number): string => (rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`)

/** Whole-number totals with grouping, locale-independent (this is federated content). */
const formatTotal = (total: number): string => Math.round(total).toLocaleString('en-US')

/** `a`, `a and b`, `a, b and c`. */
const joinNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** Mastodon-style mention markup, linking the member's public profile. */
const mentionHtml = (entry: ChallengeResultEntry): string => {
  const handle = identityToHandle(entry.identity_base_url)
  const shown = handle ? handle.slice(0, handle.lastIndexOf('@')) : entry.display_name
  return (
    `<span class="h-card"><a href="${escapeXml(entry.identity_base_url)}" class="u-url mention">` +
    `@<span>${escapeXml(shown)}</span></a></span>`
  )
}

/** The result block of a completion post: winner line (mentions), runners-up, member count. */
export const renderChallengeResultHtml = (result: ChallengeResult): string => {
  const unit = escapeXml(result.unit)
  const winners = challengeWinners(result)
  const parts: string[] = []
  if (winners.length === 1) {
    parts.push(`<p>🏆 Winner: ${mentionHtml(winners[0])} with ${formatTotal(winners[0].total)} ${unit}</p>`)
  } else if (winners.length > 1) {
    parts.push(
      `<p>🏆 Tied winners: ${joinNames(winners.map(mentionHtml))} with ${formatTotal(winners[0].total)} ${unit}</p>`,
    )
  }
  const runnersUp = result.podium.filter((entry) => entry.rank > 1)
  if (runnersUp.length > 0) {
    parts.push(
      `<p>${runnersUp
        .map(
          (entry) =>
            `${medal(entry.rank)} ${escapeXml(entry.display_name)} · ${formatTotal(entry.total)} ${unit}`,
        )
        .join('<br>')}</p>`,
    )
  }
  parts.push(`<p>${result.member_count} ${result.member_count === 1 ? 'member' : 'members'} competed.</p>`)
  return parts.join('\n')
}

/**
 * The Note `content` HTML for a challenge share. `message` is authored
 * markdown. A completion post (with `challenge.result`) gets a "has finished"
 * heading and the podium in place of the invitation heading.
 */
export const renderChallengeShareHtml = (challenge: ChallengeShare, message: string | null): string => {
  const parts = challenge.result
    ? [
        `<p><strong>${escapeXml(challenge.name)}</strong> has finished! 🏁</p>`,
        renderChallengeResultHtml(challenge.result),
      ]
    : [`<p><strong>${escapeXml(challenge.name)}</strong></p>`]
  if (message) parts.push(renderProse(message))
  parts.push(
    `<p><a href="${escapeXml(challenge.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeXml(challenge.url)}</a></p>`,
  )
  return parts.join('\n')
}
