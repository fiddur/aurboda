import { safeHttpUrl } from './join-query'

export const joinedChallengePath = (participationId: string): string =>
  `/challenges/joined/${encodeURIComponent(participationId)}`

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Where a joined challenge's row links: its own page when this server hosts it, else the
 * joined-challenge page here, so a member on another server stays signed in on their own.
 */
export const joinedChallengeHref = (
  challengeUrl: string,
  participationId: string,
  ownOrigin: string,
): string => {
  const origin = safeHttpUrl(challengeUrl) ? originOf(challengeUrl) : null
  return origin !== null && origin === originOf(ownOrigin)
    ? challengeUrl
    : joinedChallengePath(participationId)
}

/** The host's page as a link target and the host name to label it with; `null` for a non-http(s) URL. */
export const hostPageLink = (hostPageUrl: string | undefined): { href: string; host: string } | null => {
  const href = hostPageUrl ? safeHttpUrl(hostPageUrl) : null
  if (!href) return null
  try {
    return { host: new URL(href).host, href }
  } catch {
    return null
  }
}
