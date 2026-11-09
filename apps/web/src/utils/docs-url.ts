const DOCS_BASE = 'https://github.com/fiddur/aurboda/blob/main/docs/'

/** A page of the documentation on GitHub, as of the released version (`main`). */
export const docsUrl = (path: string): string => `${DOCS_BASE}${path.replace(/^\/+/, '')}`
