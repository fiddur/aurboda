/**
 * Links to the server admin's contacts, set in Admin settings and read from
 * `/status`: a fediverse handle stored as `name@host` and a Reddit username.
 */

export interface ContactLink {
  label: string
  href: string
}

export interface AdminContactLinks {
  fediverse: ContactLink | null
  reddit: ContactLink | null
}

/** A handle on this server links to the local public profile; any other to its home server. */
const fediverseLink = (handle: string, currentHost: string): ContactLink | null => {
  const at = handle.lastIndexOf('@')
  if (at <= 0) return null
  const user = handle.slice(0, at)
  const host = handle.slice(at + 1)
  const href =
    host.toLowerCase() === currentHost.toLowerCase()
      ? `/u/${encodeURIComponent(user)}`
      : `https://${host}/@${encodeURIComponent(user)}`
  return { href, label: `@${user}@${host}` }
}

const redditLink = (name: string): ContactLink => ({
  href: `https://www.reddit.com/message/compose/?to=${encodeURIComponent(name)}`,
  label: `u/${name}`,
})

export const adminContactLinks = (
  fediverse: string | null,
  reddit: string | null,
  currentHost: string,
): AdminContactLinks => ({
  fediverse: fediverse ? fediverseLink(fediverse, currentHost) : null,
  reddit: reddit ? redditLink(reddit) : null,
})

export const hasAdminContact = (links: AdminContactLinks): boolean =>
  links.fediverse != null || links.reddit != null
