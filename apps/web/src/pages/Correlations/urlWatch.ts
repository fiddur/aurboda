export interface UrlWatch {
  /** The page wrote or read `href`. */
  saw: (href: string) => void
  /** Whether `href` is another URL than the page last wrote or read: something else navigated. */
  changedElsewhere: (href: string) => boolean
}

/**
 * Tells a navigation from the page's own URL writes. The page's state reaches the URL a frame after
 * it changes, so "the URL does not show the state" is true in between and cannot mean "navigated".
 */
export const createUrlWatch = (initial: string): UrlWatch => {
  let seen = initial
  return {
    changedElsewhere: (href) => href !== seen,
    saw: (href) => {
      seen = href
    },
  }
}
