/**
 * A peer-supplied URL, kept only when it is http(s): cards render it as an `href`, and a hostile
 * instance could otherwise hand us a `javascript:` URL that runs in the app origin on click.
 */
export const httpLink = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : undefined
  } catch {
    return undefined
  }
}
