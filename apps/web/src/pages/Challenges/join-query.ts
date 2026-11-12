/** An attacker-controllable URL as a link target: only http(s), never e.g. `javascript:` (DOM XSS). */
export const safeHttpUrl = (url: string): string | null => (/^https?:\/\//i.test(url) ? url : null)

export interface JoinRequest {
  challengeUrl: string
  safeChallengeUrl: string | null
  /** Show the challenge and wait for a Join click, rather than joining on load. */
  confirm: boolean
}

/**
 * `/challenges/join?challenge=<url>[&confirm=1]`. Without `confirm` the user already clicked
 * Join on the host's page ("Join from another instance"), so the page joins on load; with it
 * (the Android widget's suggestion) nothing was clicked yet.
 */
export const parseJoinQuery = (query: Record<string, string | undefined>): JoinRequest => {
  const challengeUrl = typeof query.challenge === 'string' ? query.challenge : ''
  return { challengeUrl, confirm: query.confirm === '1', safeChallengeUrl: safeHttpUrl(challengeUrl) }
}

const splitChallengeUrl = (shareUrl: string): { base: string; username: string } | null => {
  const i = shareUrl.indexOf('/u/')
  const username = i > 0 ? shareUrl.slice(i + 3).split('/')[0] : ''
  return username ? { base: shareUrl.slice(0, i).replace(/\/+$/, ''), username } : null
}

/**
 * Where a confirmed join lands: never the share URL itself when the host is another
 * instance, which the Android WebView would hand to the browser, where the user is not
 * logged in. The challenge's own page when this instance hosts it, else `/challenges`.
 */
export const confirmedJoinTarget = (shareUrl: string, ownOrigin: string): string => {
  const parts = splitChallengeUrl(shareUrl)
  if (!parts || parts.base !== ownOrigin.replace(/\/+$/, '')) return '/challenges'
  return shareUrl.slice(parts.base.length)
}

/** The host's profile as named by the challenge link itself (`<base>/u/<username>`), http(s) only. */
export const hostProfileUrl = (shareUrl: string): string | null => {
  const parts = splitChallengeUrl(shareUrl)
  return parts ? safeHttpUrl(`${parts.base}/u/${parts.username}`) : null
}

export const joinPagePath = (challengeUrl: string, confirm: boolean): string =>
  `/challenges/join?challenge=${encodeURIComponent(challengeUrl)}${confirm ? '&confirm=1' : ''}`
