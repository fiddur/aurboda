/** The lowercased host of an actor URI, without port; null when it is not a URL with a host. */
export const actorHost = (actorUri: string): string | null => {
  try {
    const host = new URL(actorUri).hostname.toLowerCase()
    return host === '' ? null : host
  } catch {
    return null
  }
}

/** Whether `host` is `domain` or one of its subdomains. */
export const hostMatches = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)
